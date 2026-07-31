-- Percepat rounding-fixup di send_ecer_preps_to_customer:
-- subquery "SELECT ... FROM sales WHERE user_id=? AND customer_id IS NOT DISTINCT FROM ? ORDER BY created_at DESC LIMIT 1"
-- sebelumnya mengandalkan idx_sales_user (user_id, created_at DESC) lalu memfilter customer_id
-- → berat pada user dengan sales sangat banyak. Composite index di bawah membuatnya
-- langsung index-scan LIMIT 1 tanpa filter tambahan.
CREATE INDEX IF NOT EXISTS idx_sales_user_customer_created
  ON public.sales (user_id, customer_id, created_at DESC);