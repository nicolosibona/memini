# Memini Product Roadmap

Updated November 21, 2026 · Next milestone **first purchase review with pilot buyers**

Memini helps small importers see what was agreed, what changed, and what evidence supports each term before they pay a deposit or the final balance. The **purchase dossier** starts with the first quote. If a problem arises, the buyer can trace agreements, revisions, and reports in one place.

A buyer on Reddit reports citing the written agreement in a Trade Assurance claim after three failed inspections and later receiving a refund. This is one buyer’s experience. The pilot will test whether Memini helps buyers reconstruct the agreement faster and spot discrepancies before deciding whether to proceed. [Buyer’s account](https://www.reddit.com/r/Alibaba/comments/1q09ofb/part_3_my_trade_assurance_experience_refund/)

## How to update the roadmap

Check off an item once its acceptance criterion is met. For work that has started, add the **status**, **owner**, and a **link to the pull request or verification** at the end of the item. Use *To do*, *In progress*, *Blocked*, and *Verified*. The phases follow their dependencies. The prototype can advance with sample data while the technical foundations are in progress. Add owners and dates as the team assigns them.

## Before the pilot

- [ ] **Workspace access and private attachments.** Replace the fixed demo workspace with sign-in and workspace-level permissions. Keep demo data and its reset separate. **Acceptance criterion.** Two accounts can work on their own purchases. Attempts to access the other account’s purchases, original files, or exports are denied. [Current demo workspace](lib/server.ts)
- [ ] **Recoverable imports.** Save the original before extraction. Show processing status, allow retries without duplicates, and send unreadable PDFs, uncertain data, and ambiguous supplier matches for review. **Acceptance criterion.** Simulate a timeout, a page reload, a duplicate submission, and an unreadable PDF. The original remains accessible and manual correction is available.
- [ ] **Reliable quote comparison.** Fix the lowest-price highlight in `Compare quotes`. Store amounts and currencies as separate fields and compare offers on the same basis for product, quantity, currency, and delivery terms. Show missing costs and state the assumptions behind any landed-cost estimate. **Acceptance criterion.** A price highlight appears only when currency, quantity, and Incoterms match or have been explicitly normalized. [Current quote comparison](app/compare/page.tsx)
- [ ] **Recovery and error handling.** Test backups, database and attachment restoration, and processing error reporting. **Acceptance criterion.** Restore a test purchase with an intact history and working links to the original files.

## First buyer workflow

- [ ] **Create a purchase from a PDF or message.** Let buyers start with a PDF or a pasted message and confirm the supplier when needed. **Acceptance criterion.** A buyer creates their first purchase on desktop and mobile without setting up WeChat.
- [ ] **Agreement history.** Keep every version of the pro forma invoice and record the source and date for both proposed and buyer-confirmed terms. **Acceptance criterion.** When a revised invoice arrives, both original files remain accessible. The buyer can see which terms were in effect and which fields changed. Reuse the message and document references already stored with facts. [Fact records](lib/core/facts.ts)
- [ ] **Pre-deposit review.** Surface relevant differences in price, quantity, delivery, payment terms, and payee. Each row shows the previous and new values, the original excerpt, and the next action. Buyers can correct a value or copy a request in Chinese. **Acceptance criterion.** On desktop and mobile, buyers can find the changes to the Incoterm and payee in the demo and trace them to their sources. The view distinguishes missing data, disputed values, and confirmed corrections.
- [ ] **Exportable purchase dossier.** Include the timeline, confirmed terms, unresolved discrepancies, and an index of the original files. Let buyers choose which attachments to share. **Acceptance criterion.** A recipient can reconstruct a change in terms using the dossier and selected attachments without a Memini account.
- [ ] **Pilot with five buyers.** Use active negotiations and appropriately redacted documents. The initial target is **four out of five buyers completing the review unaided in under five minutes**. Track confirmed discrepancies, buyer actions, and unprompted returns when a revised invoice arrives. Measure how long it takes to find the agreement and the two key pieces of evidence with the buyer’s usual tools and with Memini.

## After the pilot

- [ ] **Timeline through final payment.** Track the sample, production completion, inspection, and shipment. Show an owner, promised date, latest update, and source for each milestone. **Acceptance criterion.** A date change preserves the earlier commitment and creates a visible next action.
- [ ] **Inspection results and corrective actions.** Link the inspection report and approved sample to the purchase. Record the result, corrective action, follow-up inspection, and buyer decision. **Acceptance criterion.** After a failed inspection, the dossier shows what was disputed, what correction was requested, and the evidence documenting it.
- [ ] **WeChat intake and supplier confirmations.** Test message delivery, duplicate handling, and purchase matching in the field. If manual handoffs slow down buyers in the pilot, consider a time-limited link for suppliers to confirm a date or upload a requested document.

## Interface references

| Product and screen | Pattern to test in Memini |
| --- | --- |
| [Adobe Acrobat Pro comparison results](https://helpx.adobe.com/acrobat/using/compare-documents.html) | Summarize the changes at the top, show a before-and-after view, and link to the exact source passage. Each row in Memini represents a commercial term, such as the Incoterm. |
| [SourceReady quote comparison](https://www.sourceready.com/supplier-outreach) | Show price, minimum order quantity, and lead time side by side. In Memini, show the currency, delivery location, and missing information next to the amount. |
| [Anvyl order details and milestone confirmation](https://anvylhelp.zendesk.com/hc/en-us/articles/14712939522573-Accept-your-first-purchase-order) | Give each order one page for activity, documents, and confirmations. In Memini, put the buyer’s next action at the top. |
| [myQIMA reports and decisions](https://www.qima.com/online-platform) | Show the result and date next to the report, along with the decision and any follow-up action. In Memini, link the report to the inspection milestone and the purchase dossier. |

Use public guides and screenshots to identify design patterns. For specific interaction questions, such as how a screen handles concurrent revisions, start with a public demo or an authorized account. Consider REA when those sources leave a behavior undocumented.
