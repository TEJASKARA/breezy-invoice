import assert from "node:assert/strict"
import test from "node:test"
import { cleanDate, cleanEmail, cleanMarketingRows, cleanName, cleanPhone, detectMarketingSource } from "../src/lib/marketing-leads.ts"

const gstRow = (overrides = {}) => ({
  "ï»¿GSTIN": "36APVPM9788H1ZP", Name: "MD KASEEM", "Business Name": "MD KASEEM", "Business Nature": "Retail & Wholesale Trading",
  "Business Type": "REG", "Date Of Registration": new Date(2026, 9, 31), "Registered Mobile Number": "6309076262",
  "Registered Email Address": "Kaseemmd56@gmail.com", State: "Telangana", City: "Medchal Malkajgiri", Zipcode: 500010, ...overrides,
})
const mcaRow = (overrides = {}) => ({
  entityId: "U30300UP2026PTC254332", entityType: "company", name: "CHAKRASPACE PRIVATE LIMITED", state: "Uttar Pradesh",
  nicLabel: "Manufacture of Air and Spacecraft", classOfCompany: "Private", dateOfIncorporation: "01-11-2026",
  paidUpCapital: "100000", directorName: "ARYA DAS", directorEmail: "ARYADAS98@GMAIL.COM", directorMobile: "``+918420233990", ...overrides,
})

test("emails are lower-cased, trimmed and validated", () => {
  assert.deepEqual(cleanEmail("  Kaseemmd56@Gmail.COM "), { email: "kaseemmd56@gmail.com", reason: null })
  assert.equal(cleanEmail("a@b.com; c@d.com").email, "a@b.com")
  assert.equal(cleanEmail("mailto:x@y.in").email, "x@y.in")
  assert.equal(cleanEmail("").reason, "missing")
  assert.equal(cleanEmail("NA").reason, "missing")
  assert.equal(cleanEmail("abc@gmail").reason, "invalid")
  assert.equal(cleanEmail("a..b@gmail.com").reason, "invalid")
})

test("phones become +91 mobile numbers and MCA backticks are removed", () => {
  assert.equal(cleanPhone("``+918420233990"), "+918420233990")
  assert.equal(cleanPhone("6309076262"), "+916309076262")
  assert.equal(cleanPhone("09650695941"), "+919650695941")
  assert.equal(cleanPhone(""), null)
  assert.equal(cleanPhone("123"), null)
})

test("names and dates are normalised", () => {
  assert.equal(cleanName("ARYA DAS"), "Arya Das")
  assert.equal(cleanName("Chhaya Jain"), "Chhaya Jain")
  assert.equal(cleanDate("01-11-2026"), "2026-11-01")
  assert.equal(cleanDate(new Date(2026, 9, 31)), "2026-10-31")
  assert.equal(cleanDate(new Date(2026, 9, 30, 23, 59, 50)), "2026-10-31")
  assert.equal(cleanDate("31/02/2026"), null)
})

test("GST export is detected and cleaned", () => {
  const rows = [gstRow(), gstRow({ "Registered Email Address": " KASEEMMD56@gmail.com" }), gstRow({ "Registered Email Address": "" }), gstRow({ "Registered Email Address": "bad@" })]
  assert.equal(detectMarketingSource(rows), "gst")
  const result = cleanMarketingRows(rows)
  assert.equal(result.totalRows, 4)
  assert.equal(result.leads.length, 1)
  assert.equal(result.duplicateInFile, 1)
  assert.equal(result.missingEmail, 1)
  assert.equal(result.invalidEmail, 1)
  assert.deepEqual(result.leads[0], {
    email: "kaseemmd56@gmail.com", contact_name: "Md Kaseem", business_name: "MD KASEEM", phone: "+916309076262",
    state: "Telangana", city: "Medchal Malkajgiri", source: "gst", source_ref: "36APVPM9788H1ZP", registered_on: "2026-10-31",
    details: { business_nature: "Retail & Wholesale Trading", business_type: "REG", pincode: "500010" },
  })
})

test("MCA export keeps one contact per director email", () => {
  const rows = [mcaRow(), mcaRow({ directorName: "DIPAK KUMAR GIRI", directorEmail: "judipakkumar@gmail.com" }), mcaRow()]
  assert.equal(detectMarketingSource(rows), "mca")
  const result = cleanMarketingRows(rows)
  assert.equal(result.leads.length, 2)
  assert.equal(result.duplicateInFile, 1)
  assert.equal(result.leads[0].email, "aryadas98@gmail.com")
  assert.equal(result.leads[0].contact_name, "Arya Das")
  assert.equal(result.leads[0].phone, "+918420233990")
  assert.equal(result.leads[0].registered_on, "2026-11-01")
  assert.equal(result.leads[0].source_ref, "U30300UP2026PTC254332")
})

test("unknown files are rejected with a clear message", () => {
  assert.throws(() => cleanMarketingRows([{ foo: "bar" }]), /not a recognised GST or MCA export/)
})
