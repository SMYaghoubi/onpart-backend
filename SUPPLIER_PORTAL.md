# Supplier portal deployment

1. Run `migrations/004_create_supplier_portal.sql` once on the Liara MySQL database.
2. Deploy the backend package.
3. Deploy the matching frontend package.
4. In Admin > Suppliers, approve a supplier.
5. Open the key/access button, choose allowed brands/products, and save.
6. The supplier can sign in at `/supplier/login` with the existing OTP template.

Supplier changes are staged in review batches. Product prices and stocks change only after a marketer approves a batch and selects the markup percentage.
