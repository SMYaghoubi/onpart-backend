# Supplier product photos

This adds one optional photo to the existing supplier single-product form and existing review batches. It does not introduce another seller panel, change membership/approval, or alter pricing calculations.

## Lifecycle

- The supplier selects a JPEG, PNG, or WebP up to 5 MiB, previews it, and stages it alongside the product. Existing products can receive a photo-only proposal. Excel/paste flows remain unchanged; photos can be added with the single-product form.
- Drafts retain an opaque photo ID in the existing supplier-specific browser draft, never a base64 file or bearer token.
- Uploads require the existing approved supplier session and an allowed brand. Files are decoded, EXIF-oriented, stripped of metadata, resized within 1600 x 1600 without cropping, and encoded as WebP. The decoder rejects malformed, mismatched and animated images and inputs over 25 million pixels.
- Pending files live under the persistent upload disk's .supplier-product-images directory. They are not served by express.static (including on an application rollback). Authenticated supplier endpoints enforce ownership; existing management roles can review photos through their own authenticated endpoint.
- Submission binds the supplier-owned draft photo to the existing batch/item inside the submission transaction. Another supplier's ID, reused ID, or expired draft photo rolls submission back.
- The existing management approval applies the image together with the reviewed batch. Images of matched existing products are replaced only during approval. Previous image files are not deleted. The admin screen shows the existing and proposed image for existing-product changes.
- The public approved-image path additionally verifies committed photo state, the active product, and its current image. A copy left by an interrupted/rolled-back approval is hidden. Failed approvals remove newly copied files; a later approval can recover an orphaned, uncommitted copy.
- Rejection leaves the existing product image and values unchanged, and marks the proposed image rejected with the batch. Suppliers can view their own submitted images in history.

## Storage and compatibility

- Existing persistent UPLOAD_PATH configuration is reused. No new server credential, bucket, or external image service is needed.
- New dependency: sharp 0.35.5; deployment needs Node.js >= 20.9.0 and installation of optional native dependencies. The Liara production Node version has not been inspected.
- Migration 022_supplier_product_images.sql creates one new table. Existing inventory schema initialization is reused and this table is initialized on the first authenticated supplier inventory/image operation. No existing columns or records are migrated.
- No production migration has been executed during development.
- Uploads are limited to 30 per supplier per 10 minutes and two simultaneous processing requests per application process. A supplier may hold up to 100 staged photos. Unsubmitted drafts expire after seven days and expired draft files are cleaned up during that supplier's next upload. Submitted/rejected photos are retained for review history; disk usage should be considered before a broad supplier rollout.

## Validation and release

Backend: node --test test/supplierImages.test.js test/supplierInventory.test.js test/supplierManagementAuth.test.js test/privateDocuments.test.js

The new HTTP tests use the actual Express routers, multipart parser, existing JWT auth, image decoder and temporary files with a strict in-memory database/transaction double. They cover pending privacy, ownership, idempotent submission, approval, rejection, photo-only changes, invalid files, rollback cleanup, crash-copy recovery and the legacy no-photo path. They do not execute migration SQL against a real MySQL server.

The paired frontend was tested in a browser against the same isolated fixture, including selection, preview, stage, submission, management review/approval, approved thumbnail loading and photo replacement at a 390px mobile viewport. Frontend brand, management-context and numeric-price regressions were also checked.

Before production release, verify the Liara Node runtime and available persistent disk space, test migration 022 and the complete flow on a non-production MySQL database, and deploy the backend before the paired frontend. Keep both pull requests unmerged until the user approves release.

