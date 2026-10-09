# Invoice-wide GST type

Implemented locally, not deployed. Choose CGST + SGST or IGST once for the entire
individual invoice. Each line keeps its own total GST percentage. The inactive
tax fields are disabled. Editing CGST or SGST keeps both percentages equal.

Switching the invoice tax type recalculates every line, preserving its amount
basis (taxable amount or inclusive total). Inclusive totals remain exact after
paise rounding. The selected mode is restored with the saved browser draft.

Old drafts, quotation conversions and corrections infer the mode from existing
taxes. Existing mixed records are not silently rewritten: review the selected
mode and use Apply selected tax type to all lines before saving.

The invoice store rejects mixed taxes before changing invoice-number counters.
Repository validation covers invoice saves, replacements and bulk imports.
Bulk import rejects an invoice with conflicting tax types even across separate
spreadsheet rows belonging to the same invoice.

Apply `202610090003_invoice_tax_mode.sql` in Supabase, then deploy the frontend.
The database trigger checks both summary taxes and every line on insert/update,
including direct API writes. It does not rewrite historical invoices. Updating
a historically mixed invoice requires correcting its tax breakdown first.

Verification: frontend calculator/validation tests, production build, lint,
backend regression suite and disposable database tests (including rejected
invoice credit rollback). After deployment, smoke-test both tax modes and a
multi-row bulk import with a controlled account.
