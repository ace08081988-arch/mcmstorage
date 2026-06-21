ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'ID',
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'id',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'IDR',
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'DD/MM/YYYY';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_country_code_chk CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT profiles_language_chk CHECK (language IN ('id','en')),
  ADD CONSTRAINT profiles_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT profiles_date_format_chk CHECK (date_format IN ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD MMM YYYY'));