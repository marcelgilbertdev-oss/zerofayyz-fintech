# Case Study — A Payments Platform Built to Be Inspected

*Written for a reader who does not work in software.*

## What it is

A web application that takes a card payment and keeps an accurate record of what happened.
It runs in Stripe's sandbox, which is a complete copy of the real payment system that moves
no actual money. Everything works exactly as it would in production, using test card numbers
instead of real ones.

There are two halves. A dashboard you look at, showing what has been paid, what is still
processing, and whether the system is healthy. And a service behind it that talks to Stripe,
writes to the database, and answers the dashboard's questions.

## The problem it solves

Taking a payment is the easy part. Knowing, with certainty, what happened to it is the hard
part.

When someone pays, the money does not move instantly and our system is not told immediately.
Stripe sends a message afterwards saying how it went. That message can arrive late, arrive
twice, arrive out of order, or arrive from someone pretending to be Stripe. A payments system
is mostly the discipline of handling all four of those cases correctly, every time.

## Three decisions worth explaining

**The card details never touch this system.** Clicking pay sends you to a page Stripe hosts.
Building our own payment form would look slightly more polished and would drag us into a
substantially heavier set of security obligations, because we would then be handling card
numbers. Sending you to Stripe is the less impressive-looking choice and the correct one.

**The database refuses duplicates, rather than the code checking for them.** If Stripe tells
us twice that a payment succeeded, we must not record it twice. The obvious approach is to
look first and then write — but if two copies of that message arrive at the same moment, both
look, both find nothing, and both write. So instead the database itself is told that a given
Stripe message may only ever be recorded once. It does not matter how many arrive or how
fast; the second one is simply ignored. The rule lives somewhere it cannot be forgotten.

**The key we hold can only do one thing.** Talking to Stripe requires a key. The default key
can do anything the account can do, including issue refunds. This system uses a restricted
key that can only start a payment. If it were ever stolen, the thief could start payments to
us — and nothing else.

## The bug that proves the testing was real

Partway through, the project had nineteen automated tests and all of them passed.

The part of the system that receives Stripe's messages had never actually worked. Not once.
Every one of those tests replaced the real database with a stand-in, so none of them ever ran
the actual database instruction — and that instruction had a flaw that made the database
reject it outright. In production, every payment confirmation would have failed.

The first test written against a real database found it immediately.

This is the useful part of the story. The tests were not wrong, and there were not too few of
them. They had a *shape*, and the defect was sitting in the one place that shape did not
reach. Adding a different kind of test, rather than more of the same kind, is what found it.
The system now runs three kinds: fast tests for logic, slower ones against a real database,
and a handful that drive a real browser through the whole path a person would take.

Every one of them runs automatically before any change can be accepted.

## The second half: who is allowed to do what

Once payments worked, the platform gained the part every operations system eventually needs
— a locked half. The dashboard stayed public deliberately: anyone reviewing the project must
be able to see it working without being asked to sign in first. Behind a login sits the
operational side: a history of everything the system did, a live list of who is signed in at
this moment, and the ability to sign someone out.

Three decisions there are worth stating plainly, because each one was a choice with a cost.

**Passwords are stored scrambled, one way, using a method built into the platform itself
rather than an add-on.** The add-on is slightly stronger. It also has to be installed
separately for each kind of computer, and that exact problem had already broken this
project's automated checks twice. A password protection that might not install is worse than
one that is marginally less strong and always present.

**Signing someone out actually signs them out.** The popular modern approach hands the
visitor a self-contained pass that every server accepts until it expires — which means
nobody can cancel it early, and nobody can say who is currently signed in. This platform
keeps the record on the server, so an administrator can end a session and the person is
locked out on their very next click. That was demonstrated live: a session was ended while
in use, and the same unchanged, still-valid-looking pass stopped working immediately.

**The history cannot be edited, including by the software itself.** The database refuses
attempts to change or delete those records, from every connection. This mattered more than
expected — making it genuinely permanent revealed that ordinary links between tables were
quietly capable of altering it, and those links had to be removed. A record that the system
could rewrite is not evidence of anything.

One more detail, chosen on principle: the history deliberately does *not* record visitors'
network addresses. It records enough to tell two visitors apart and to stop someone guessing
passwords, and nothing that could identify or locate a person.

## What it demonstrates

- Building a complete application end to end — interface, service, database, deployment
- Designing access control, and deciding deliberately what stays public rather than locking
  everything by reflex
- Integrating a payment provider correctly, including the parts that are easy to get wrong
- Designing a data model that can reconstruct what happened, not just what is true now
- Writing tests that are structured around how software actually fails
- Setting up a pipeline that checks all of this automatically
- Documenting decisions so that the next person inherits the reasoning, not just the code

## The honest limits

It is a portfolio prototype, not a product. No real money moves, and there are no real
customers. The administrator console reads far more than it changes — issuing refunds and
managing accounts are the next things to build. The payment path was finished properly
before any of the rest began, on the view that one complete thing is worth more than three
partial ones.

Those limits are stated in the project's own README as well. A system that is honest about
what it does not do is easier to trust about what it does.
