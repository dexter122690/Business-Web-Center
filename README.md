# Business Web Center

A self-contained business-management prototype for invoices, sales reporting, expenses, quotations, payroll, schedules, client feedback, branch workspaces, and local administration.

## Open locally

Open `index.html` in a modern browser. The employee time clock, receipt scanner, and Admin Control Center are available from the system interface.

## Secure account system

- `auth.html` is the Sign in / Create account page.
- Run `supabase/schema.sql` first, then `supabase/002_signup_workflow.sql` in the Supabase SQL Editor.
- Copy `app-config.example.js` to `app-config.js`, then add the Supabase project URL and **publishable / anon** key.
- Never put the Supabase `service_role` key in this website.

## Important

This is currently a browser-local prototype. Records are stored in that browser's local storage. Before offering the system to customers, connect it to secure online authentication, a database, and server-side backups.
