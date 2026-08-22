// Package reconciler independently re-derives payment state from the
// append-only event log and compares it with the mutable payments table.
//
// Why this exists, and why in Go.
//
// The platform keeps two records of every payment: `payments`, which holds
// where a payment stands now, and `transactions`, an append-only log of
// everything that happened and when it was learned. The second is the record
// of truth. If the first ever disagrees with it, the ledger is wrong and
// nobody is being told.
//
// A reconciler written inside the API would share the API's model of what a
// refund means, its ORM, its assumptions — and would therefore agree with the
// API's bugs. An independent implementation, in a different language, reading
// the database directly, can disagree. That disagreement is the entire point:
// this is a second opinion, not a second copy.
package reconciler

import (
	"fmt"
	"sort"
	"time"
)

// Event is one row of the append-only log.
type Event struct {
	Type       string
	AmountMin  int64
	OccurredAt time.Time
}

// Payment is the mutable current-state row being checked.
type Payment struct {
	ID        string
	AmountMin int64
	Status    string
}

// Discrepancy is a payment whose stored state the log does not support.
type Discrepancy struct {
	PaymentID string `json:"paymentId"`
	Stored    string `json:"storedStatus"`
	Derived   string `json:"derivedStatus"`
	Reason    string `json:"reason"`
}

// terminalFor maps an event type to the payment status it implies.
var terminalFor = map[string]string{
	"payment_created":    "created",
	"payment_processing": "processing",
	"payment_succeeded":  "succeeded",
	"payment_failed":     "failed",
	"payment_canceled":   "canceled",
}

// DeriveStatus computes what a payment's status should be, given only its
// events and its amount.
//
// The subtlety this function exists for is refunds. A `payment_refunded` event
// is written for a partial refund too, so "there is a refund event, therefore
// the payment is refunded" is wrong — it would flag every partially refunded
// payment as a discrepancy and teach whoever reads the report to ignore it. A
// payment is refunded only once the refunded amounts reach what was captured.
//
// Events are sorted rather than assumed ordered: the log is ordered by when
// things were *learned*, and webhook deliveries can arrive out of sequence.
func DeriveStatus(payment Payment, events []Event) (string, error) {
	if len(events) == 0 {
		// No log at all is not "created" — it is an absence, and calling it a
		// status would silently bless a payment nothing ever recorded.
		return "", fmt.Errorf("payment %s has no events", payment.ID)
	}

	ordered := make([]Event, len(events))
	copy(ordered, events)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].OccurredAt.Before(ordered[j].OccurredAt)
	})

	status := ""
	var refunded int64

	for _, event := range ordered {
		if event.Type == "payment_refunded" {
			refunded += event.AmountMin
			continue
		}

		mapped, known := terminalFor[event.Type]
		if !known {
			// An unrecognised event type is a schema change this program has
			// not been taught about. Refusing is correct: silently ignoring it
			// would let a new lifecycle state pass unchecked forever.
			return "", fmt.Errorf("payment %s has unknown event type %q", payment.ID, event.Type)
		}
		status = mapped
	}

	if refunded > 0 {
		if status != "succeeded" {
			return "", fmt.Errorf(
				"payment %s was refunded from status %q — money moved back from a payment that never settled",
				payment.ID, status)
		}
		if refunded > payment.AmountMin {
			return "", fmt.Errorf(
				"payment %s refunded %d of %d — more was returned than was captured",
				payment.ID, refunded, payment.AmountMin)
		}
		if refunded == payment.AmountMin {
			return "refunded", nil
		}
		// Partially refunded payments stay succeeded. This is the case that
		// makes a naive reconciler cry wolf.
		return "succeeded", nil
	}

	return status, nil
}

// Check compares one payment against its events.
func Check(payment Payment, events []Event) *Discrepancy {
	derived, err := DeriveStatus(payment, events)
	if err != nil {
		return &Discrepancy{
			PaymentID: payment.ID,
			Stored:    payment.Status,
			Derived:   "undeterminable",
			Reason:    err.Error(),
		}
	}

	if derived != payment.Status {
		return &Discrepancy{
			PaymentID: payment.ID,
			Stored:    payment.Status,
			Derived:   derived,
			Reason:    "stored status is not what the event log implies",
		}
	}

	return nil
}
