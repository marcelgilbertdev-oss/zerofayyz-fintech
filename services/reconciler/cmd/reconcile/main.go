// Command reconcile checks the payments table against the append-only event
// log and exits non-zero if they disagree.
//
// Built to be run on a schedule and to be silent when there is nothing to say.
// It reads; it never writes. A reconciler that could "fix" what it found would
// be able to destroy the evidence of the bug it exists to surface.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	reconciler "github.com/marcelgilbertdev-oss/zerofayyz-fintech/services/reconciler"
)

type report struct {
	CheckedAt     string                    `json:"checkedAt"`
	Payments      int                       `json:"paymentsChecked"`
	Events        int                       `json:"eventsRead"`
	Discrepancies []reconciler.Discrepancy  `json:"discrepancies"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "reconcile: %v\n", err)
		os.Exit(2)
	}
}

func run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)

	payments, err := loadPayments(ctx, conn)
	if err != nil {
		return err
	}

	events, total, err := loadEvents(ctx, conn)
	if err != nil {
		return err
	}

	// Never nil: an empty JSON array is a result, `null` is ambiguous to
	// whatever reads this next.
	discrepancies := []reconciler.Discrepancy{}

	for _, payment := range payments {
		if found := reconciler.Check(payment, events[payment.ID]); found != nil {
			discrepancies = append(discrepancies, *found)
		}
	}

	out, err := json.MarshalIndent(report{
		CheckedAt:     time.Now().UTC().Format(time.RFC3339),
		Payments:      len(payments),
		Events:        total,
		Discrepancies: discrepancies,
	}, "", "  ")
	if err != nil {
		return err
	}

	fmt.Println(string(out))

	if len(discrepancies) > 0 {
		// Non-zero so a scheduler treats a divergent ledger as a failure
		// rather than a log line nobody opens.
		os.Exit(1)
	}

	return nil
}

func loadPayments(ctx context.Context, conn *pgx.Conn) ([]reconciler.Payment, error) {
	rows, err := conn.Query(ctx, `
		SELECT id::TEXT, amount_minor, status
		  FROM payments
		 ORDER BY created_at
	`)
	if err != nil {
		return nil, fmt.Errorf("query payments: %w", err)
	}
	defer rows.Close()

	var payments []reconciler.Payment

	for rows.Next() {
		var payment reconciler.Payment
		if err := rows.Scan(&payment.ID, &payment.AmountMin, &payment.Status); err != nil {
			return nil, fmt.Errorf("scan payment: %w", err)
		}
		payments = append(payments, payment)
	}

	return payments, rows.Err()
}

func loadEvents(ctx context.Context, conn *pgx.Conn) (map[string][]reconciler.Event, int, error) {
	rows, err := conn.Query(ctx, `
		SELECT payment_id::TEXT, event_type, amount_minor, occurred_at
		  FROM transactions
	`)
	if err != nil {
		return nil, 0, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	byPayment := make(map[string][]reconciler.Event)
	total := 0

	for rows.Next() {
		var paymentID string
		var event reconciler.Event
		if err := rows.Scan(&paymentID, &event.Type, &event.AmountMin, &event.OccurredAt); err != nil {
			return nil, 0, fmt.Errorf("scan transaction: %w", err)
		}
		byPayment[paymentID] = append(byPayment[paymentID], event)
		total++
	}

	return byPayment, total, rows.Err()
}
