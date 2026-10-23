// Minimal Supabase-shaped local PostgreSQL fixtures; not a hosted Supabase stack.
export const bootstrap = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text, phone text, raw_user_meta_data jsonb DEFAULT '{}',
 raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now(), last_sign_in_at timestamptz,
 encrypted_password text, role text DEFAULT 'authenticated',
 aud text, email_confirmed_at timestamptz, phone_confirmed_at timestamptz
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
 $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE TABLE storage.buckets (
 id text PRIMARY KEY, name text NOT NULL, owner uuid, owner_id text,
 public boolean DEFAULT false, file_size_limit bigint,
 allowed_mime_types text[], created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
 name text, owner uuid, owner_id text, metadata jsonb, version text,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 last_accessed_at timestamptz DEFAULT now()
);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
 $$ SELECT (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
CREATE FUNCTION storage.filename(text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT reverse(split_part(reverse($1),'/',1)) $$;
CREATE FUNCTION storage.extension(text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT reverse(split_part(reverse($1),'.',1)) $$;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
`;
