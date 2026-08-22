package reconciler

import (
	"testing"
	"time"
)

func at(minutes int) time.Time {
	return time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC).Add(time.Duration(minutes) * time.Minute)
}

func TestDeriveStatus(t *testing.T) {
	cases := []struct {
		name    string
		payment Payment
		events  []Event
		want    string
		wantErr bool
	}{
		{
			name:    "a settled payment",
			payment: Payment{ID: "p1", AmountMin: 4200, Status: "succeeded"},
			events: []Event{
				{Type: "payment_created", AmountMin: 4200, OccurredAt: at(0)},
				{Type: "payment_succeeded", AmountMin: 4200, OccurredAt: at(1)},
			},
			want: "succeeded",
		},
		{
			name:    "the last event wins, not the loudest",
			payment: Payment{ID: "p2", AmountMin: 4200, Status: "canceled"},
			events: []Event{
				{Type: "payment_created", AmountMin: 4200, OccurredAt: at(0)},
				{Type: "payment_processing", AmountMin: 4200, OccurredAt: at(1)},
				{Type: "payment_canceled", AmountMin: 4200, OccurredAt: at(2)},
			},
			want: "canceled",
		},
		{
			// Webhooks arrive out of order. A reconciler that trusted row order
			// would derive "processing" here and report a false discrepancy on
			// a perfectly good payment.
			name:    "events delivered out of order are sorted before deriving",
			payment: Payment{ID: "p3", AmountMin: 4200, Status: "succeeded"},
			events: []Event{
				{Type: "payment_succeeded", AmountMin: 4200, OccurredAt: at(2)},
				{Type: "payment_created", AmountMin: 4200, OccurredAt: at(0)},
				{Type: "payment_processing", AmountMin: 4200, OccurredAt: at(1)},
			},
			want: "succeeded",
		},
		{
			// The case that makes a naive reconciler cry wolf on every
			// partially refunded payment until nobody reads the report.
			name:    "a partial refund leaves the payment succeeded",
			payment: Payment{ID: "p4", AmountMin: 10000, Status: "succeeded"},
			events: []Event{
				{Type: "payment_created", AmountMin: 10000, OccurredAt: at(0)},
				{Type: "payment_succeeded", AmountMin: 10000, OccurredAt: at(1)},
				{Type: "payment_refunded", AmountMin: 2500, OccurredAt: at(2)},
			},
			want: "succeeded",
		},
		{
			name:    "refunds accumulate to the full amount",
			payment: Payment{ID: "p5", AmountMin: 10000, Status: "refunded"},
			events: []Event{
				{Type: "payment_created", AmountMin: 10000, OccurredAt: at(0)},
				{Type: "payment_succeeded", AmountMin: 10000, OccurredAt: at(1)},
				{Type: "payment_refunded", AmountMin: 2500, OccurredAt: at(2)},
				{Type: "payment_refunded", AmountMin: 7500, OccurredAt: at(3)},
			},
			want: "refunded",
		},
		{
			name:    "refunding more than was captured is refused, not rounded away",
			payment: Payment{ID: "p6", AmountMin: 5000, Status: "refunded"},
			events: []Event{
				{Type: "payment_created", AmountMin: 5000, OccurredAt: at(0)},
				{Type: "payment_succeeded", AmountMin: 5000, OccurredAt: at(1)},
				{Type: "payment_refunded", AmountMin: 9000, OccurredAt: at(2)},
			},
			wantErr: true,
		},
		{
			name:    "money cannot come back from a payment that never settled",
			payment: Payment{ID: "p7", AmountMin: 5000, Status: "refunded"},
			events: []Event{
				{Type: "payment_created", AmountMin: 5000, OccurredAt: at(0)},
				{Type: "payment_failed", AmountMin: 5000, OccurredAt: at(1)},
				{Type: "payment_refunded", AmountMin: 5000, OccurredAt: at(2)},
			},
			wantErr: true,
		},
		{
			name:    "a payment with no events is an absence, not a status",
			payment: Payment{ID: "p8", AmountMin: 4200, Status: "created"},
			events:  nil,
			wantErr: true,
		},
		{
			// A new lifecycle state added to the schema must break this
			// program loudly rather than pass unchecked forever.
			name:    "an unknown event type is refused",
			payment: Payment{ID: "p9", AmountMin: 4200, Status: "succeeded"},
			events: []Event{
				{Type: "payment_disputed", AmountMin: 4200, OccurredAt: at(0)},
			},
			wantErr: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := DeriveStatus(testCase.payment, testCase.events)

			if testCase.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got status %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("derived %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestCheckReportsDisagreement(t *testing.T) {
	// The defect this whole service exists to catch: the log says the money
	// settled, the payments table says it failed.
	payment := Payment{ID: "p10", AmountMin: 4200, Status: "failed"}
	events := []Event{
		{Type: "payment_created", AmountMin: 4200, OccurredAt: at(0)},
		{Type: "payment_succeeded", AmountMin: 4200, OccurredAt: at(1)},
	}

	discrepancy := Check(payment, events)

	if discrepancy == nil {
		t.Fatal("expected a discrepancy when stored status contradicts the log")
	}
	if discrepancy.Stored != "failed" || discrepancy.Derived != "succeeded" {
		t.Fatalf("unexpected discrepancy: %+v", discrepancy)
	}
}

func TestCheckStaysQuietWhenTheyAgree(t *testing.T) {
	payment := Payment{ID: "p11", AmountMin: 4200, Status: "succeeded"}
	events := []Event{
		{Type: "payment_created", AmountMin: 4200, OccurredAt: at(0)},
		{Type: "payment_succeeded", AmountMin: 4200, OccurredAt: at(1)},
	}

	if discrepancy := Check(payment, events); discrepancy != nil {
		t.Fatalf("expected no discrepancy, got %+v", discrepancy)
	}
}
