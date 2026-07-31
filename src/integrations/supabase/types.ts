export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      address_book: {
        Row: {
          created_at: string
          device_contact_id: string | null
          email: string | null
          email_norm: string | null
          id: string
          linked_user_id: string | null
          name: string
          note: string | null
          phone: string | null
          phone_norm: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_contact_id?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          linked_user_id?: string | null
          name: string
          note?: string | null
          phone?: string | null
          phone_norm?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_contact_id?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          linked_user_id?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          phone_norm?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_denial_events: {
        Row: {
          created_at: string
          fn: string
          id: string
          reason: string
          referer: string | null
          ua: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fn: string
          id?: string
          reason?: string
          referer?: string | null
          ua?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fn?: string
          id?: string
          reason?: string
          referer?: string | null
          ua?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      apk_download_events: {
        Row: {
          created_at: string
          id: string
          referrer: string | null
          source: string
          user_agent: string | null
          user_id: string | null
          variant: string
        }
        Insert: {
          created_at?: string
          id?: string
          referrer?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string | null
          variant: string
        }
        Update: {
          created_at?: string
          id?: string
          referrer?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string | null
          variant?: string
        }
        Relationships: []
      }
      apk_min_supported: {
        Row: {
          created_at: string
          min_version_code: number | null
          min_version_name: string | null
          reason: string | null
          updated_at: string
          updated_by: string | null
          variant: string
        }
        Insert: {
          created_at?: string
          min_version_code?: number | null
          min_version_name?: string | null
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          variant: string
        }
        Update: {
          created_at?: string
          min_version_code?: number | null
          min_version_name?: string | null
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          variant?: string
        }
        Relationships: []
      }
      apk_release_meta: {
        Row: {
          created_at: string
          enabled: boolean
          file_name: string
          notes: string | null
          publish_at: string | null
          updated_at: string
          updated_by: string | null
          variant: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          file_name: string
          notes?: string | null
          publish_at?: string | null
          updated_at?: string
          updated_by?: string | null
          variant: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          file_name?: string
          notes?: string | null
          publish_at?: string | null
          updated_at?: string
          updated_by?: string | null
          variant?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          bank_account_holder: string
          bank_account_number: string
          bank_name: string
          created_at: string
          id: boolean
          pro_price_monthly_idr: number
          pro_price_yearly_idr: number
          trial_days: number
          updated_at: string
          whatsapp_admin: string
          worker_portal_config: Json
        }
        Insert: {
          bank_account_holder?: string
          bank_account_number?: string
          bank_name?: string
          created_at?: string
          id?: boolean
          pro_price_monthly_idr?: number
          pro_price_yearly_idr?: number
          trial_days?: number
          updated_at?: string
          whatsapp_admin?: string
          worker_portal_config?: Json
        }
        Update: {
          bank_account_holder?: string
          bank_account_number?: string
          bank_name?: string
          created_at?: string
          id?: boolean
          pro_price_monthly_idr?: number
          pro_price_yearly_idr?: number
          trial_days?: number
          updated_at?: string
          whatsapp_admin?: string
          worker_portal_config?: Json
        }
        Relationships: []
      }
      auto_send_audit: {
        Row: {
          created_at: string
          finalized_at: string | null
          id: string
          note: string | null
          outcome: string
          prep_count: number
          prep_ids: string[]
          title_id: string
          total_grams: number
          unit_label: string | null
          user_id: string
          warehouse_item_id: string | null
        }
        Insert: {
          created_at?: string
          finalized_at?: string | null
          id?: string
          note?: string | null
          outcome: string
          prep_count?: number
          prep_ids?: string[]
          title_id: string
          total_grams?: number
          unit_label?: string | null
          user_id: string
          warehouse_item_id?: string | null
        }
        Update: {
          created_at?: string
          finalized_at?: string | null
          id?: string
          note?: string | null
          outcome?: string
          prep_count?: number
          prep_ids?: string[]
          title_id?: string
          total_grams?: number
          unit_label?: string | null
          user_id?: string
          warehouse_item_id?: string | null
        }
        Relationships: []
      }
      business_notify_hook_config: {
        Row: {
          enabled: boolean
          hook_url: string | null
          id: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      chat_calls: {
        Row: {
          accepted_at: string | null
          callee_id: string | null
          caller_id: string
          conversation_id: string
          created_at: string
          duration_sec: number
          end_reason: string | null
          ended_at: string | null
          id: string
          kind: string
          started_at: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          callee_id?: string | null
          caller_id: string
          conversation_id: string
          created_at?: string
          duration_sec?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          kind: string
          started_at?: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          callee_id?: string | null
          caller_id?: string
          conversation_id?: string
          created_at?: string
          duration_sec?: number
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          kind?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_delete_audit: {
        Row: {
          action: Database["public"]["Enums"]["chat_delete_action"]
          actor_user_id: string
          conversation_id: string
          count: number
          created_at: string
          id: string
          message_id: string | null
          message_ids: string[] | null
        }
        Insert: {
          action: Database["public"]["Enums"]["chat_delete_action"]
          actor_user_id?: string
          conversation_id: string
          count?: number
          created_at?: string
          id?: string
          message_id?: string | null
          message_ids?: string[] | null
        }
        Update: {
          action?: Database["public"]["Enums"]["chat_delete_action"]
          actor_user_id?: string
          conversation_id?: string
          count?: number
          created_at?: string
          id?: string
          message_id?: string | null
          message_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_delete_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_list_members: {
        Row: {
          added_at: string
          conversation_id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          conversation_id: string
          list_id: string
        }
        Update: {
          added_at?: string
          conversation_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_list_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "chat_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_lists: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_notes: {
        Row: {
          body: string
          conversation_id: string | null
          created_at: string
          id: string
          source_message_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          source_message_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          source_message_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_party_links: {
        Row: {
          alias_key: string
          alias_label: string
          created_at: string
          id: string
          party_key: string
          party_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alias_key: string
          alias_label: string
          created_at?: string
          id?: string
          party_key: string
          party_name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          alias_key?: string
          alias_label?: string
          created_at?: string
          id?: string
          party_key?: string
          party_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_quick_replies: {
        Row: {
          body: string
          created_at: string
          id: string
          shortcut: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          shortcut: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          shortcut?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          archived_at: string | null
          cleared_at: string | null
          conversation_id: string
          joined_at: string
          last_delivered_at: string | null
          last_read_at: string | null
          notifications_muted_until: string | null
          pinned_at: string | null
          role: string
          sound_enabled: boolean
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          cleared_at?: string | null
          conversation_id: string
          joined_at?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          notifications_muted_until?: string | null
          pinned_at?: string | null
          role?: string
          sound_enabled?: boolean
          user_id: string
        }
        Update: {
          archived_at?: string | null
          cleared_at?: string | null
          conversation_id?: string
          joined_at?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          notifications_muted_until?: string | null
          pinned_at?: string | null
          role?: string
          sound_enabled?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          category: string
          created_at: string
          created_by: string
          id: string
          kind: string
          last_message_at: string | null
          linked_customer_id: string | null
          linked_ecer_prep_id: string | null
          linked_product_id: string | null
          linked_request_prep_id: string | null
          linked_task_id: string | null
          order_request_id: string | null
          owner_user_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by: string
          id?: string
          kind: string
          last_message_at?: string | null
          linked_customer_id?: string | null
          linked_ecer_prep_id?: string | null
          linked_product_id?: string | null
          linked_request_prep_id?: string | null
          linked_task_id?: string | null
          order_request_id?: string | null
          owner_user_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          last_message_at?: string | null
          linked_customer_id?: string | null
          linked_ecer_prep_id?: string | null
          linked_product_id?: string | null
          linked_request_prep_id?: string | null
          linked_task_id?: string | null
          order_request_id?: string | null
          owner_user_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_linked_customer_id_fkey"
            columns: ["linked_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_linked_ecer_prep_id_fkey"
            columns: ["linked_ecer_prep_id"]
            isOneToOne: false
            referencedRelation: "ecer_preparations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_linked_product_id_fkey"
            columns: ["linked_product_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_linked_request_prep_id_fkey"
            columns: ["linked_request_prep_id"]
            isOneToOne: false
            referencedRelation: "request_preparations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_linked_task_id_fkey"
            columns: ["linked_task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_order_request_id_fkey"
            columns: ["order_request_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          note: string | null
          sale_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          note?: string | null
          sale_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          note?: string | null
          sale_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          account_user_id: string | null
          contact: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_user_id?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_user_id?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      debt_adjust_audit: {
        Row: {
          action: string
          actor_name: string | null
          amount: number
          balance_after: number | null
          balance_before: number | null
          conversation_id: string | null
          created_at: string
          detail: Json
          id: string
          kind: string
          party_name: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor_name?: string | null
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          conversation_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          party_name?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor_name?: string | null
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          conversation_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          party_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      debt_payments: {
        Row: {
          amount: number
          created_at: string
          debt_id: string
          id: string
          note: string | null
          paid_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          debt_id: string
          id?: string
          note?: string | null
          paid_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          debt_id?: string
          id?: string
          note?: string | null
          paid_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_payments_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          due_date: string | null
          id: string
          kind: string
          note: string | null
          party_name: string
          source: string
          source_id: string | null
          supplier_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          kind: string
          note?: string | null
          party_name: string
          source?: string
          source_id?: string | null
          supplier_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          note?: string | null
          party_name?: string
          source?: string
          source_id?: string | null
          supplier_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      device_otp_challenges: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          device_hash: string
          expires_at: string
          id: string
          last_ip: string | null
          last_user_agent: string | null
          otp_message_id: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          device_hash: string
          expires_at: string
          id?: string
          last_ip?: string | null
          last_user_agent?: string | null
          otp_message_id?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          device_hash?: string
          expires_at?: string
          id?: string
          last_ip?: string | null
          last_user_agent?: string | null
          otp_message_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      device_sessions: {
        Row: {
          created_at: string
          device_id: string
          id: string
          label: string | null
          last_seen_at: string
          platform: string | null
          revoked_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          label?: string | null
          last_seen_at?: string
          platform?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          label?: string | null
          last_seen_at?: string
          platform?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      doc_sequences: {
        Row: {
          created_at: string
          day: string
          id: string
          last_seq: number
          prefix: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day: string
          id?: string
          last_seq?: number
          prefix: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          last_seq?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      ecer_preparations: {
        Row: {
          actual_grams: number
          archived_at: string | null
          created_at: string
          created_by: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          location_url: string | null
          note: string | null
          photo_path: string | null
          photo_paths: string[]
          prep_submission_id: string | null
          prep_task_item_id: string | null
          ready_at: string | null
          rejection_reason: string | null
          sold_at: string | null
          sold_customer_id: string | null
          sold_note: string | null
          sold_paid_amount: number | null
          sold_party_name: string | null
          sold_payment_method: string | null
          sold_total: number | null
          title_id: string
          user_id: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          warehouse_item_id: string
        }
        Insert: {
          actual_grams: number
          archived_at?: string | null
          created_at?: string
          created_by?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          prep_submission_id?: string | null
          prep_task_item_id?: string | null
          ready_at?: string | null
          rejection_reason?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_note?: string | null
          sold_paid_amount?: number | null
          sold_party_name?: string | null
          sold_payment_method?: string | null
          sold_total?: number | null
          title_id: string
          user_id: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          warehouse_item_id: string
        }
        Update: {
          actual_grams?: number
          archived_at?: string | null
          created_at?: string
          created_by?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          prep_submission_id?: string | null
          prep_task_item_id?: string | null
          ready_at?: string | null
          rejection_reason?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_note?: string | null
          sold_paid_amount?: number | null
          sold_party_name?: string | null
          sold_payment_method?: string | null
          sold_total?: number | null
          title_id?: string
          user_id?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          warehouse_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecer_preparations_prep_submission_id_fkey"
            columns: ["prep_submission_id"]
            isOneToOne: false
            referencedRelation: "prep_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecer_preparations_prep_submission_id_fkey"
            columns: ["prep_submission_id"]
            isOneToOne: false
            referencedRelation: "prep_submissions_unrouted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecer_preparations_prep_task_item_id_fkey"
            columns: ["prep_task_item_id"]
            isOneToOne: false
            referencedRelation: "prep_task_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecer_preparations_sold_customer_id_fkey"
            columns: ["sold_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecer_preparations_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "ecer_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecer_preparations_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ecer_send_events: {
        Row: {
          caption_preview: string | null
          channel: string
          created_at: string
          customer_id: string | null
          error_message: string | null
          id: string
          note: string | null
          outcome: string
          paid_amount: number | null
          party_contact: string | null
          party_name: string | null
          payment_method: string | null
          photo_count: number
          prep_count: number
          prep_ids: string[]
          title_id: string | null
          total_amount: number | null
          user_id: string
        }
        Insert: {
          caption_preview?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          note?: string | null
          outcome?: string
          paid_amount?: number | null
          party_contact?: string | null
          party_name?: string | null
          payment_method?: string | null
          photo_count?: number
          prep_count?: number
          prep_ids?: string[]
          title_id?: string | null
          total_amount?: number | null
          user_id: string
        }
        Update: {
          caption_preview?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          note?: string | null
          outcome?: string
          paid_amount?: number | null
          party_contact?: string | null
          party_name?: string | null
          payment_method?: string | null
          photo_count?: number
          prep_count?: number
          prep_ids?: string[]
          title_id?: string | null
          total_amount?: number | null
          user_id?: string
        }
        Relationships: []
      }
      ecer_titles: {
        Row: {
          created_at: string
          id: string
          name: string
          note: string | null
          position: number
          target_grams: number
          unit_label: string
          updated_at: string
          user_id: string
          warehouse_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note?: string | null
          position?: number
          target_grams?: number
          unit_label?: string
          updated_at?: string
          user_id: string
          warehouse_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          position?: number
          target_grams?: number
          unit_label?: string
          updated_at?: string
          user_id?: string
          warehouse_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecer_titles_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      email_monitor_config: {
        Row: {
          admin_email: string
          cooldown_minutes: number
          created_at: string
          enabled: boolean
          error_min_sample: number
          error_rate_threshold: number
          id: number
          last_check_at: string | null
          last_error_alert_at: string | null
          last_stale_alert_at: string | null
          stale_threshold_minutes: number
          updated_at: string
        }
        Insert: {
          admin_email: string
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          error_min_sample?: number
          error_rate_threshold?: number
          id?: number
          last_check_at?: string | null
          last_error_alert_at?: string | null
          last_stale_alert_at?: string | null
          stale_threshold_minutes?: number
          updated_at?: string
        }
        Update: {
          admin_email?: string
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          error_min_sample?: number
          error_rate_threshold?: number
          id?: number
          last_check_at?: string | null
          last_error_alert_at?: string | null
          last_stale_alert_at?: string | null
          stale_threshold_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_queue_alerts: {
        Row: {
          alert_type: string
          created_at: string
          delivery_error: string | null
          delivery_status: string | null
          id: string
          message: string
          metadata: Json | null
          notified_email: string | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string | null
          id?: string
          message: string
          metadata?: Json | null
          notified_email?: string | null
          severity?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          notified_email?: string | null
          severity?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      fcm_tokens: {
        Row: {
          created_at: string
          device_info: string | null
          id: string
          last_used_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: string | null
          id?: string
          last_used_at?: string
          platform?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: string | null
          id?: string
          last_used_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      friend_notify_hook_config: {
        Row: {
          enabled: boolean
          hook_url: string | null
          id: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      friend_requests: {
        Row: {
          created_at: string
          from_user: string
          id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["friend_request_status"]
          to_user: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_user: string
          id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["friend_request_status"]
          to_user: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_user?: string
          id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["friend_request_status"]
          to_user?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_hidden: {
        Row: {
          hidden_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          hidden_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          hidden_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_hidden_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_duration_sec: number | null
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          pinned_at: string | null
          reply_to_id: string | null
          sender_id: string
          starred_by: string[]
        }
        Insert: {
          attachment_duration_sec?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          pinned_at?: string | null
          reply_to_id?: string | null
          sender_id: string
          starred_by?: string[]
        }
        Update: {
          attachment_duration_sec?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          pinned_at?: string | null
          reply_to_id?: string | null
          sender_id?: string
          starred_by?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      order_request_events: {
        Row: {
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          order_id: string
          to_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          order_id: string
          to_status: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          order_id?: string
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_request_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      order_requests: {
        Row: {
          cart_group_id: string | null
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          id: string
          item_id: string | null
          item_name: string | null
          note: string | null
          price_per_unit: number | null
          qty: number
          qty_mode: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cart_group_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          note?: string | null
          price_per_unit?: number | null
          qty: number
          qty_mode: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cart_group_id?: string | null
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id?: string | null
          item_name?: string | null
          note?: string | null
          price_per_unit?: number | null
          qty?: number
          qty_mode?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_requests_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      org_branding: {
        Row: {
          brand_color: string
          logo_url: string
          org_name: string
          org_short: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_color?: string
          logo_url?: string
          org_name?: string
          org_short?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_color?: string
          logo_url?: string
          org_name?: string
          org_short?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      portal_error_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          code: string | null
          count: number
          created_at: string
          id: string
          kind: string
          severity: string
          token_hash: string | null
          window_seconds: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code?: string | null
          count: number
          created_at?: string
          id?: string
          kind: string
          severity?: string
          token_hash?: string | null
          window_seconds: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code?: string | null
          count?: number
          created_at?: string
          id?: string
          kind?: string
          severity?: string
          token_hash?: string | null
          window_seconds?: number
        }
        Relationships: []
      }
      portal_error_audit: {
        Row: {
          code: string | null
          count: number
          first_seen_at: string
          hour_bucket: string
          id: string
          kind: string
          last_seen_at: string
        }
        Insert: {
          code?: string | null
          count?: number
          first_seen_at?: string
          hour_bucket: string
          id?: string
          kind: string
          last_seen_at?: string
        }
        Update: {
          code?: string | null
          count?: number
          first_seen_at?: string
          hour_bucket?: string
          id?: string
          kind?: string
          last_seen_at?: string
        }
        Relationships: []
      }
      portal_error_events: {
        Row: {
          code: string | null
          created_at: string
          id: string
          ip_hash: string | null
          kind: string
          route: string | null
          status: string | null
          token_hash: string | null
          ua: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          kind: string
          route?: string | null
          status?: string | null
          token_hash?: string | null
          ua?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          kind?: string
          route?: string | null
          status?: string | null
          token_hash?: string | null
          ua?: string | null
        }
        Relationships: []
      }
      prep_link_deliveries: {
        Row: {
          channel: string
          id: string
          owner_user_id: string
          sent_at: string
          task_id: string | null
          title_id: string | null
          title_name: string
          worker_name: string
        }
        Insert: {
          channel: string
          id?: string
          owner_user_id: string
          sent_at?: string
          task_id?: string | null
          title_id?: string | null
          title_name: string
          worker_name: string
        }
        Update: {
          channel?: string
          id?: string
          owner_user_id?: string
          sent_at?: string
          task_id?: string | null
          title_id?: string | null
          title_name?: string
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_link_deliveries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_link_deliveries_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "request_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_pin_alerts: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          failure_count: number
          id: string
          owner_user_id: string
          share_token: string
          task_id: string
          window_end: string
          window_start: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          failure_count: number
          id?: string
          owner_user_id: string
          share_token: string
          task_id: string
          window_end?: string
          window_start: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          failure_count?: number
          id?: string
          owner_user_id?: string
          share_token?: string
          task_id?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_pin_alerts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_pin_failures: {
        Row: {
          attempted_at: string
          id: string
          share_token: string
        }
        Insert: {
          attempted_at?: string
          id?: string
          share_token: string
        }
        Update: {
          attempted_at?: string
          id?: string
          share_token?: string
        }
        Relationships: []
      }
      prep_submissions: {
        Row: {
          gps_lat: number | null
          gps_lng: number | null
          id: string
          location_url: string | null
          note: string | null
          photo_path: string | null
          photo_paths: string[]
          qty_reported: number | null
          rejection_reason: string | null
          sent_at: string | null
          sent_channel: string | null
          sent_maps_url: string | null
          submitted_at: string
          task_id: string
          task_item_id: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          qty_reported?: number | null
          rejection_reason?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_maps_url?: string | null
          submitted_at?: string
          task_id: string
          task_item_id: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          qty_reported?: number | null
          rejection_reason?: string | null
          sent_at?: string | null
          sent_channel?: string | null
          sent_maps_url?: string | null
          submitted_at?: string
          task_id?: string
          task_item_id?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prep_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_submissions_task_item_id_fkey"
            columns: ["task_item_id"]
            isOneToOne: false
            referencedRelation: "prep_task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_submit_wa_hook: {
        Row: {
          enabled: boolean
          forward_url: string | null
          id: boolean
          updated_at: string
          wa_target: string | null
        }
        Insert: {
          enabled?: boolean
          forward_url?: string | null
          id?: boolean
          updated_at?: string
          wa_target?: string | null
        }
        Update: {
          enabled?: boolean
          forward_url?: string | null
          id?: boolean
          updated_at?: string
          wa_target?: string | null
        }
        Relationships: []
      }
      prep_task_items: {
        Row: {
          category_snapshot: string | null
          created_at: string
          ecer_title_id: string | null
          id: string
          name_snapshot: string
          note: string | null
          position: number
          qty_prepared: number
          qty_requested: number
          ref_photo_path: string | null
          task_id: string
          unit_label: string | null
          updated_at: string
          warehouse_item_id: string | null
        }
        Insert: {
          category_snapshot?: string | null
          created_at?: string
          ecer_title_id?: string | null
          id?: string
          name_snapshot: string
          note?: string | null
          position?: number
          qty_prepared?: number
          qty_requested?: number
          ref_photo_path?: string | null
          task_id: string
          unit_label?: string | null
          updated_at?: string
          warehouse_item_id?: string | null
        }
        Update: {
          category_snapshot?: string | null
          created_at?: string
          ecer_title_id?: string | null
          id?: string
          name_snapshot?: string
          note?: string | null
          position?: number
          qty_prepared?: number
          qty_requested?: number
          ref_photo_path?: string | null
          task_id?: string
          unit_label?: string | null
          updated_at?: string
          warehouse_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prep_task_items_ecer_title_id_fkey"
            columns: ["ecer_title_id"]
            isOneToOne: false
            referencedRelation: "ecer_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_task_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_task_items_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_task_notify_hook_config: {
        Row: {
          enabled: boolean
          hook_url: string | null
          id: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          hook_url?: string | null
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      prep_task_request_titles: {
        Row: {
          created_at: string
          task_id: string
          title_id: string
        }
        Insert: {
          created_at?: string
          task_id: string
          title_id: string
        }
        Update: {
          created_at?: string
          task_id?: string
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_task_request_titles_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_task_request_titles_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "request_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_task_wa_hook_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          last_retry_at: string | null
          new_status: string | null
          owner_user_id: string
          payload: Json | null
          prev_status: string | null
          retry_count: number
          send_status: string
          task_id: string | null
          title: string | null
          wa_target: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          last_retry_at?: string | null
          new_status?: string | null
          owner_user_id: string
          payload?: Json | null
          prev_status?: string | null
          retry_count?: number
          send_status: string
          task_id?: string | null
          title?: string | null
          wa_target?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          last_retry_at?: string | null
          new_status?: string | null
          owner_user_id?: string
          payload?: Json | null
          prev_status?: string | null
          retry_count?: number
          send_status?: string
          task_id?: string | null
          title?: string | null
          wa_target?: string | null
        }
        Relationships: []
      }
      prep_tasks: {
        Row: {
          completed_at: string | null
          completion_note: string | null
          created_at: string
          employee_id: string | null
          expires_at: string
          id: string
          max_submissions: number
          note: string | null
          owner_user_id: string
          pin_hash: string
          pin_updated_at: string
          scheduled_at: string | null
          share_token: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          employee_id?: string | null
          expires_at?: string
          id?: string
          max_submissions?: number
          note?: string | null
          owner_user_id: string
          pin_hash: string
          pin_updated_at?: string
          scheduled_at?: string | null
          share_token: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string
          employee_id?: string | null
          expires_at?: string
          id?: string
          max_submissions?: number
          note?: string | null
          owner_user_id?: string
          pin_hash?: string
          pin_updated_at?: string
          scheduled_at?: string | null
          share_token?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      prep_upload_grants: {
        Row: {
          expires_at: string
          issued_at: string
          share_token: string
        }
        Insert: {
          expires_at: string
          issued_at?: string
          share_token: string
        }
        Update: {
          expires_at?: string
          issued_at?: string
          share_token?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          chat_only: boolean
          country_code: string
          created_at: string
          currency: string
          date_format: string
          default_status_visibility: Database["public"]["Enums"]["status_visibility"]
          display_name: string | null
          email: string | null
          id: string
          invite_code: string
          language: string
          last_seen_at: string | null
          phone: string | null
          show_last_seen: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          chat_only?: boolean
          country_code?: string
          created_at?: string
          currency?: string
          date_format?: string
          default_status_visibility?: Database["public"]["Enums"]["status_visibility"]
          display_name?: string | null
          email?: string | null
          id: string
          invite_code?: string
          language?: string
          last_seen_at?: string | null
          phone?: string | null
          show_last_seen?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          chat_only?: boolean
          country_code?: string
          created_at?: string
          currency?: string
          date_format?: string
          default_status_visibility?: Database["public"]["Enums"]["status_visibility"]
          display_name?: string | null
          email?: string | null
          id?: string
          invite_code?: string
          language?: string
          last_seen_at?: string | null
          phone?: string | null
          show_last_seen?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          base_added: number
          created_at: string
          id: string
          item_id: string
          package_qty: number
          package_size_snapshot: number
          payment_method: string
          price_per_package: number
          supplier_id: string | null
          total_cost: number
          user_id: string
        }
        Insert: {
          base_added: number
          created_at?: string
          id?: string
          item_id: string
          package_qty: number
          package_size_snapshot: number
          payment_method?: string
          price_per_package: number
          supplier_id?: string | null
          total_cost: number
          user_id: string
        }
        Update: {
          base_added?: number
          created_at?: string
          id?: string
          item_id?: string
          package_qty?: number
          package_size_snapshot?: number
          payment_method?: string
          price_per_package?: number
          supplier_id?: string | null
          total_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      query_metrics: {
        Row: {
          created_at: string
          duration_ms: number
          id: number
          meta: Json | null
          query_name: string
          row_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms: number
          id?: number
          meta?: Json | null
          query_name: string
          row_count?: number | null
          user_id?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number
          id?: number
          meta?: Json | null
          query_name?: string
          row_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      ready_packages: {
        Row: {
          created_at: string
          customer_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          location_url: string | null
          note: string | null
          photo_path: string | null
          price_per_base: number | null
          qty_base: number
          sent_at: string | null
          sent_to_name: string | null
          sent_to_phone: string | null
          status: string
          total_price: number | null
          updated_at: string
          user_id: string
          warehouse_item_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          price_per_base?: number | null
          qty_base: number
          sent_at?: string | null
          sent_to_name?: string | null
          sent_to_phone?: string | null
          status?: string
          total_price?: number | null
          updated_at?: string
          user_id: string
          warehouse_item_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          price_per_base?: number | null
          qty_base?: number
          sent_at?: string | null
          sent_to_name?: string | null
          sent_to_phone?: string | null
          status?: string
          total_price?: number | null
          updated_at?: string
          user_id?: string
          warehouse_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ready_packages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_packages_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      request_preparation_items: {
        Row: {
          actual_grams: number
          created_at: string
          id: string
          preparation_id: string
          user_id: string
          warehouse_item_id: string
        }
        Insert: {
          actual_grams?: number
          created_at?: string
          id?: string
          preparation_id: string
          user_id: string
          warehouse_item_id: string
        }
        Update: {
          actual_grams?: number
          created_at?: string
          id?: string
          preparation_id?: string
          user_id?: string
          warehouse_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_preparation_items_preparation_id_fkey"
            columns: ["preparation_id"]
            isOneToOne: false
            referencedRelation: "request_preparations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_preparation_items_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      request_preparations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          location_url: string | null
          location_urls: string[] | null
          note: string | null
          photo_path: string | null
          photo_paths: string[]
          prep_task_item_id: string | null
          ready_at: string | null
          rejection_reason: string | null
          sold_at: string | null
          sold_customer_id: string | null
          sold_paid_amount: number | null
          sold_party_name: string | null
          sold_payment_method: string | null
          sold_total: number | null
          title_id: string
          user_id: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          via_task_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          location_urls?: string[] | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          prep_task_item_id?: string | null
          ready_at?: string | null
          rejection_reason?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_paid_amount?: number | null
          sold_party_name?: string | null
          sold_payment_method?: string | null
          sold_total?: number | null
          title_id: string
          user_id: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          via_task_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          location_url?: string | null
          location_urls?: string[] | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          prep_task_item_id?: string | null
          ready_at?: string | null
          rejection_reason?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_paid_amount?: number | null
          sold_party_name?: string | null
          sold_payment_method?: string | null
          sold_total?: number | null
          title_id?: string
          user_id?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          via_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_preparations_sold_customer_id_fkey"
            columns: ["sold_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_preparations_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "request_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_title_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          position: number
          target_grams: number
          title_id: string
          unit_label: string
          updated_at: string
          warehouse_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          position?: number
          target_grams?: number
          title_id: string
          unit_label?: string
          updated_at?: string
          warehouse_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          position?: number
          target_grams?: number
          title_id?: string
          unit_label?: string
          updated_at?: string
          warehouse_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_title_items_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "request_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_title_items_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      request_titles: {
        Row: {
          created_at: string
          id: string
          name: string
          note: string | null
          position: number
          reprep_requested_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note?: string | null
          position?: number
          reprep_requested_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          position?: number
          reprep_requested_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          cost_at_sale: number
          created_at: string
          customer_id: string | null
          id: string
          item_id: string
          note: string | null
          payment_method: string
          price_per_base: number
          qty_base: number
          source: string | null
          source_id: string | null
          total_revenue: number
          user_id: string
        }
        Insert: {
          cost_at_sale?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id: string
          note?: string | null
          payment_method?: string
          price_per_base: number
          qty_base: number
          source?: string | null
          source_id?: string | null
          total_revenue: number
          user_id: string
        }
        Update: {
          cost_at_sale?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id?: string
          note?: string | null
          payment_method?: string
          price_per_base?: number
          qty_base?: number
          source?: string | null
          source_id?: string | null
          total_revenue?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      scroll_guard_config: {
        Row: {
          config: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      security_ack_rate_limit: {
        Row: {
          called_at: string
          id: number
          user_id: string
        }
        Insert: {
          called_at?: string
          id?: number
          user_id: string
        }
        Update: {
          called_at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      security_hook_audit: {
        Row: {
          created_at: string
          headers: Json | null
          hook_name: string
          id: string
          ip: string | null
          presented_auth_hash: string | null
          reason: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          headers?: Json | null
          hook_name: string
          id?: string
          ip?: string | null
          presented_auth_hash?: string | null
          reason: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          headers?: Json | null
          hook_name?: string
          id?: string
          ip?: string | null
          presented_auth_hash?: string | null
          reason?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      security_scan_findings: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          code: string
          detail: Json
          first_seen_at: string
          id: string
          last_run_id: string | null
          last_seen_at: string
          notified_at: string | null
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code: string
          detail?: Json
          first_seen_at?: string
          id?: string
          last_run_id?: string | null
          last_seen_at?: string
          notified_at?: string | null
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code?: string
          detail?: Json
          first_seen_at?: string
          id?: string
          last_run_id?: string | null
          last_seen_at?: string
          notified_at?: string | null
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_scan_findings_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "security_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      security_scan_hook_secrets: {
        Row: {
          hook_name: string
          hook_secret: string
          updated_at: string
        }
        Insert: {
          hook_name: string
          hook_secret?: string
          updated_at?: string
        }
        Update: {
          hook_name?: string
          hook_secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      security_scan_runs: {
        Row: {
          finding_count: number
          finished_at: string | null
          id: string
          new_count: number
          resolved_count: number
          started_at: string
          status: string
        }
        Insert: {
          finding_count?: number
          finished_at?: string | null
          id?: string
          new_count?: number
          resolved_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          finding_count?: number
          finished_at?: string | null
          id?: string
          new_count?: number
          resolved_count?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      self_prep_items: {
        Row: {
          created_at: string
          id: string
          location_url: string | null
          note: string | null
          photo_path: string | null
          photo_paths: string[]
          sent_at: string | null
          sent_channel: string | null
          sent_summary: string | null
          sent_to: string | null
          sold_at: string | null
          sold_customer_id: string | null
          sold_debt_id: string | null
          sold_paid_amount: number | null
          sold_payment_method: string | null
          sold_summary: string | null
          sold_total: number | null
          status: string
          title: string
          updated_at: string
          user_id: string
          wa_target: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          sent_at?: string | null
          sent_channel?: string | null
          sent_summary?: string | null
          sent_to?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_debt_id?: string | null
          sold_paid_amount?: number | null
          sold_payment_method?: string | null
          sold_summary?: string | null
          sold_total?: number | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          wa_target?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location_url?: string | null
          note?: string | null
          photo_path?: string | null
          photo_paths?: string[]
          sent_at?: string | null
          sent_channel?: string | null
          sent_summary?: string | null
          sent_to?: string | null
          sold_at?: string | null
          sold_customer_id?: string | null
          sold_debt_id?: string | null
          sold_paid_amount?: number | null
          sold_payment_method?: string | null
          sold_summary?: string | null
          sold_total?: number | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          wa_target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "self_prep_items_sold_customer_id_fkey"
            columns: ["sold_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_prep_items_sold_debt_id_fkey"
            columns: ["sold_debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_hook_config: {
        Row: {
          endpoint_url: string
          id: number
          secret: string
          updated_at: string
        }
        Insert: {
          endpoint_url: string
          id?: number
          secret: string
          updated_at?: string
        }
        Update: {
          endpoint_url?: string
          id?: number
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      signup_attempts: {
        Row: {
          created_at: string
          email: string | null
          failure_code: string | null
          failure_details: string | null
          id: number
          ip: string
          succeeded: boolean
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          failure_code?: string | null
          failure_details?: string | null
          id?: number
          ip: string
          succeeded?: boolean
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          failure_code?: string | null
          failure_details?: string | null
          id?: number
          ip?: string
          succeeded?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      staff_contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          pin_chat_mcm: string | null
          updated_at: string
          user_id: string
          wa_phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          pin_chat_mcm?: string | null
          updated_at?: string
          user_id: string
          wa_phone: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          pin_chat_mcm?: string | null
          updated_at?: string
          user_id?: string
          wa_phone?: string
        }
        Relationships: []
      }
      status_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          status_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          status_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          status_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_comments_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      status_likes: {
        Row: {
          created_at: string
          status_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          status_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          status_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_likes_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      statuses: {
        Row: {
          bg_color: string | null
          caption: string | null
          created_at: string
          expires_at: string
          id: string
          media_path: string
          media_type: string
          media_url: string
          user_id: string
          visibility: Database["public"]["Enums"]["status_visibility"]
        }
        Insert: {
          bg_color?: string | null
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          media_path: string
          media_type: string
          media_url: string
          user_id: string
          visibility?: Database["public"]["Enums"]["status_visibility"]
        }
        Update: {
          bg_color?: string | null
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          media_path?: string
          media_type?: string
          media_url?: string
          user_id?: string
          visibility?: Database["public"]["Enums"]["status_visibility"]
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          admin_note: string | null
          amount_idr: number
          billing_cycle: string
          created_at: string
          id: string
          proof_path: string
          reviewed_at: string | null
          reviewed_by: string | null
          sender_bank: string | null
          sender_name: string
          status: string
          transfer_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount_idr: number
          billing_cycle: string
          created_at?: string
          id?: string
          proof_path: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_bank?: string | null
          sender_name: string
          status?: string
          transfer_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount_idr?: number
          billing_cycle?: string
          created_at?: string
          id?: string
          proof_path?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_bank?: string | null
          sender_name?: string
          status?: string
          transfer_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at_period_end: boolean
          created_at: string
          environment: string
          id: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          period_end: string | null
          period_start: string | null
          plan: string
          price_id: string | null
          status: string
          trial_used_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          environment?: string
          id?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          price_id?: string | null
          status?: string
          trial_used_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          environment?: string
          id?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          price_id?: string | null
          status?: string
          trial_used_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          purchase_id: string
          supplier_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          purchase_id: string
          supplier_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          purchase_id?: string
          supplier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          account_user_id: string | null
          contact: string | null
          created_at: string
          email: string | null
          email_bcc: string | null
          email_cc: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_user_id?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          email_bcc?: string | null
          email_cc?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_user_id?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          email_bcc?: string | null
          email_cc?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_appearance_prefs: {
        Row: {
          created_at: string
          payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          payload?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          created_at: string
          device_hash: string
          id: string
          label: string | null
          last_ip: string | null
          last_seen_at: string
          last_user_agent: string | null
          trusted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          id?: string
          label?: string | null
          last_ip?: string | null
          last_seen_at?: string
          last_user_agent?: string | null
          trusted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          id?: string
          label?: string | null
          last_ip?: string | null
          last_seen_at?: string
          last_user_agent?: string | null
          trusted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notif_prefs: {
        Row: {
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_storage: {
        Row: {
          categories: Json
          created_at: string
          items: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: Json
          created_at?: string
          items?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: Json
          created_at?: string
          items?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_message_templates: {
        Row: {
          created_at: string
          id: string
          options: Json
          template: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          options?: Json
          template: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          options?: Json
          template?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouse_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouse_category_variants: {
        Row: {
          category: string
          created_at: string
          id: string
          label: string
          position: number
          unit_label: string | null
          updated_at: string
          user_id: string
          weight_per_unit: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          label: string
          position?: number
          unit_label?: string | null
          updated_at?: string
          user_id: string
          weight_per_unit?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          label?: string
          position?: number
          unit_label?: string | null
          updated_at?: string
          user_id?: string
          weight_per_unit?: number
        }
        Relationships: []
      }
      warehouse_item_variants: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          unit_label: string | null
          updated_at: string
          user_id: string
          warehouse_item_id: string
          weight_per_unit: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          position?: number
          unit_label?: string | null
          updated_at?: string
          user_id: string
          warehouse_item_id: string
          weight_per_unit?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          unit_label?: string | null
          updated_at?: string
          user_id?: string
          warehouse_item_id?: string
          weight_per_unit?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_item_variants_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_items: {
        Row: {
          avg_cost_per_base: number
          base_unit: string
          category: string | null
          created_at: string
          id: string
          image_path: string | null
          name: string
          package_size: number
          package_type: string
          stock_base: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_cost_per_base?: number
          base_unit: string
          category?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          name: string
          package_size?: number
          package_type: string
          stock_base?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_cost_per_base?: number
          base_unit?: string
          category?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          name?: string
          package_size?: number
          package_type?: string
          stock_base?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      prep_submissions_unrouted: {
        Row: {
          gps_lat: number | null
          gps_lng: number | null
          id: string | null
          location_url: string | null
          name_snapshot: string | null
          note: string | null
          owner_user_id: string | null
          photo_path: string | null
          photo_paths: string[] | null
          qty_reported: number | null
          qty_requested: number | null
          submitted_at: string | null
          task_id: string | null
          task_item_id: string | null
          unit_label: string | null
          warehouse_item_id: string | null
          warehouse_item_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prep_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "prep_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_submissions_task_item_id_fkey"
            columns: ["task_item_id"]
            isOneToOne: false
            referencedRelation: "prep_task_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_task_items_warehouse_item_id_fkey"
            columns: ["warehouse_item_id"]
            isOneToOne: false
            referencedRelation: "warehouse_items"
            referencedColumns: ["id"]
          },
        ]
      }
      query_metrics_daily_v1: {
        Row: {
          avg_ms: number | null
          avg_rows: number | null
          day: string | null
          max_ms: number | null
          p50_ms: number | null
          p95_ms: number | null
          query_name: string | null
          samples: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_contact_by_invite_code: {
        Args: { _code: string }
        Returns: {
          already_existed: boolean
          avatar_url: string
          contact_id: string
          display_name: string
          linked_user_id: string
        }[]
      }
      add_group_member: {
        Args: { _conv: string; _user: string }
        Returns: undefined
      }
      admin_approve_payment: {
        Args: { _note?: string; _payment_id: string }
        Returns: Json
      }
      admin_list_users: {
        Args: { _limit?: number; _query?: string }
        Returns: {
          created_at: string
          email: string
          is_admin: boolean
          period_end: string
          plan: string
          status: string
          user_id: string
        }[]
      }
      admin_reject_payment: {
        Args: { _note: string; _payment_id: string }
        Returns: Json
      }
      admin_set_admin_role: {
        Args: { _grant: boolean; _target: string }
        Returns: boolean
      }
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      can_chat: { Args: { _a: string; _b: string }; Returns: boolean }
      cancel_friend_request: {
        Args: { _request_id: string }
        Returns: {
          request_id: string
          status: Database["public"]["Enums"]["friend_request_status"]
        }[]
      }
      chat_clear_conversation_for_me: {
        Args: { _conv: string }
        Returns: string[]
      }
      chat_heartbeat: { Args: never; Returns: undefined }
      chat_link_business: {
        Args: { _conv: string; _id: string; _kind: string }
        Returns: Json
      }
      chat_mark_delivered: { Args: { _conv?: string }; Returns: undefined }
      chat_mute: { Args: { _conv: string; _until: string }; Returns: undefined }
      chat_search_messages: {
        Args: { _limit?: number; _q: string }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }[]
      }
      chat_set_archive: {
        Args: { _arch: boolean; _conv: string }
        Returns: undefined
      }
      chat_set_pin: {
        Args: { _conv: string; _pin: boolean }
        Returns: undefined
      }
      check_acknowledge_rate_limit: { Args: never; Returns: Json }
      check_and_record_signup_attempt: {
        Args: {
          p_email: string
          p_ip: string
          p_limit?: number
          p_user_agent?: string
          p_window?: string
        }
        Returns: {
          allowed: boolean
          attempts_in_window: number
          retry_after_seconds: number
        }[]
      }
      create_chat_cart: {
        Args: { p_conversation_id: string; p_lines: Json; p_note?: string }
        Returns: string
      }
      create_group: {
        Args: { _member_ids: string[]; _title: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      ecer_list_titles_via_task: {
        Args: { _pin: string; _token: string; _warehouse_item_id: string }
        Returns: Json
      }
      ecer_submit_via_task: {
        Args: {
          _actual_grams: number
          _gps_lat: number
          _gps_lng: number
          _location_url: string
          _note: string
          _photo_path: string
          _pin: string
          _prep_task_item_id: string
          _title_id: string
          _token: string
        }
        Returns: Json
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      email_queue_health: { Args: never; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_order_conversation: { Args: { _order: string }; Returns: string }
      expire_subscriptions: { Args: never; Returns: number }
      fix_request_prep_payment: {
        Args: {
          _paid_amount: number
          _party_name?: string
          _payment_method: string
          _prep_id: string
        }
        Returns: Json
      }
      gen_invite_code: { Args: never; Returns: string }
      get_chat_member_profiles: {
        Args: { _user_ids: string[] }
        Returns: {
          display_name: string
          id: string
          invite_code: string
          last_seen_at: string
          phone: string
          show_last_seen: boolean
        }[]
      }
      get_email_cron_secret: { Args: never; Returns: string }
      get_worker_portal_public_config: { Args: never; Returns: Json }
      has_active_pro: { Args: { _uid: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hutang_summary_v1: { Args: never; Returns: Json }
      is_chat_only: { Args: { _uid: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_conversation_owner: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      list_friend_requests: {
        Args: { _direction?: string; _only_pending?: boolean }
        Returns: {
          created_at: string
          direction: string
          from_user: string
          id: string
          peer_avatar_url: string
          peer_display_name: string
          peer_id: string
          peer_invite_code: string
          responded_at: string
          status: Database["public"]["Enums"]["friend_request_status"]
          to_user: string
        }[]
      }
      match_address_book_profiles: {
        Args: { _emails?: string[]; _phones?: string[] }
        Returns: {
          display_name: string
          match_key: string
          match_kind: string
          user_id: string
        }[]
      }
      message_delete_all_mine: { Args: { _conv: string }; Returns: string[] }
      message_delete_for_all: { Args: { _msg: string }; Returns: string }
      message_edit: {
        Args: { _body: string; _msg: string }
        Returns: undefined
      }
      message_hide_for_me: { Args: { _msg: string }; Returns: undefined }
      message_pin: { Args: { _id: string; _on: boolean }; Returns: undefined }
      message_react: {
        Args: { _emoji: string; _msg: string; _on: boolean }
        Returns: undefined
      }
      message_star: { Args: { _id: string; _on: boolean }; Returns: undefined }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_doc_number: {
        Args: { _day?: string; _prefix: string }
        Returns: string
      }
      normalize_phone: { Args: { _p: string }; Returns: string }
      normalize_unit_label: { Args: { _u: string }; Returns: string }
      party_balance_events_v1: {
        Args: { p_key?: string; p_limit?: number }
        Returns: Json
      }
      party_balance_v1: { Args: never; Returns: Json }
      piutang_summary_v1: { Args: never; Returns: Json }
      pos_commit_sale: {
        Args: {
          _item_id: string
          _note?: string
          _price_per_base: number
          _qty_base: number
        }
        Returns: string
      }
      prep_create_task: {
        Args: {
          _items: Json
          _max_submissions?: number
          _note: string
          _pin: string
          _scheduled_at?: string
          _share_token: string
          _title: string
          _title_ids?: string[]
        }
        Returns: string
      }
      prep_get_task: { Args: { _pin: string; _token: string }; Returns: Json }
      prep_peek_task: { Args: { _token: string }; Returns: Json }
      prep_pin_locked_until: { Args: { _token: string }; Returns: string }
      prep_pin_reset: { Args: { _token: string }; Returns: Json }
      prep_read_allowed: { Args: { _share_token: string }; Returns: boolean }
      prep_reset_pin: {
        Args: { _pin: string; _task_id: string }
        Returns: boolean
      }
      prep_share_token_exists: { Args: { _token: string }; Returns: boolean }
      prep_submission_verify: {
        Args: { _decision: string; _reason?: string; _submission_id: string }
        Returns: Json
      }
      prep_submissions_mark_sent: {
        Args: { _channel: string; _ids: string[]; _maps_url?: string }
        Returns: Json
      }
      prep_submissions_unmark_sent: { Args: { _ids: string[] }; Returns: Json }
      prep_submit:
        | {
            Args: {
              _gps_lat: number
              _gps_lng: number
              _location_url: string
              _note: string
              _photo_path: string
              _pin: string
              _qty_reported: number
              _task_item_id: string
              _token: string
            }
            Returns: Json
          }
        | {
            Args: {
              _expected_updated_at?: string
              _gps_lat: number
              _gps_lng: number
              _location_url: string
              _note: string
              _photo_path: string
              _pin: string
              _qty_reported: number
              _task_item_id: string
              _token: string
            }
            Returns: Json
          }
        | {
            Args: {
              _expected_updated_at?: string
              _gps_lat: number
              _gps_lng: number
              _location_url: string
              _note: string
              _photo_path: string
              _photo_paths?: string[]
              _pin: string
              _qty_reported: number
              _task_item_id: string
              _token: string
            }
            Returns: Json
          }
      prep_task_resolve: {
        Args: { _pin: string; _token: string }
        Returns: Json
      }
      prep_upload_allowed: { Args: { _share_token: string }; Returns: boolean }
      prep_worker_upload_allowed: {
        Args: { _owner_user_id: string; _share_token: string }
        Returns: boolean
      }
      query_metrics_prune: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_prep_pin_failure: { Args: { _token: string }; Returns: undefined }
      rename_warehouse_category: {
        Args: { _new_name: string; _old_name: string }
        Returns: number
      }
      repair_missing_request_task_title_links: {
        Args: { _owner_user_id?: string; _task_id?: string }
        Returns: number
      }
      request_list_titles_via_task: {
        Args: { _pin: string; _token: string }
        Returns: Json
      }
      request_submit_via_task:
        | {
            Args: {
              _gps_lat: number
              _gps_lng: number
              _items: Json
              _location_url: string
              _note: string
              _photo_path: string
              _pin: string
              _prep_task_item_id: string
              _title_id: string
              _token: string
            }
            Returns: Json
          }
        | {
            Args: {
              _gps_lat: number
              _gps_lng: number
              _items: Json
              _location_url: string
              _location_urls?: string[]
              _note: string
              _photo_path: string
              _photo_paths: string[]
              _pin: string
              _prep_task_item_id: string
              _title_id: string
              _token: string
            }
            Returns: Json
          }
      resolve_invite_code: {
        Args: { _code: string }
        Returns: {
          avatar_url: string
          chat_only: boolean
          display_name: string
          id: string
          invite_code: string
        }[]
      }
      respond_friend_request: {
        Args: { _accept: boolean; _request_id: string }
        Returns: {
          request_id: string
          status: Database["public"]["Enums"]["friend_request_status"]
        }[]
      }
      run_internal_security_scan: { Args: never; Returns: Json }
      search_chat_contacts: {
        Args: { _q: string }
        Returns: {
          display_name: string
          invite_code: string
          kind: string
          label: string
          user_id: string
        }[]
      }
      search_profiles_for_link: {
        Args: { _q: string }
        Returns: {
          display_name: string
          phone: string
          user_id: string
        }[]
      }
      security_findings_acknowledge: {
        Args: { _ids: string[] }
        Returns: number
      }
      send_ecer_preps_to_customer: {
        Args: {
          _customer_id: string
          _note: string
          _paid_amount: number
          _party_name: string
          _payment_method: string
          _prep_ids: string[]
          _total_amount: number
        }
        Returns: string[]
      }
      send_friend_request: {
        Args: { _code: string }
        Returns: {
          already_friends: boolean
          avatar_url: string
          display_name: string
          incoming_reverse_id: string
          request_id: string
          status: Database["public"]["Enums"]["friend_request_status"]
          to_user: string
          was_existing: boolean
        }[]
      }
      send_request_prep_to_customer:
        | {
            Args: {
              _customer_id: string
              _note: string
              _party_name: string
              _payment_method: string
              _prep_id: string
              _total_amount: number
            }
            Returns: string
          }
        | {
            Args: {
              _customer_id: string
              _note: string
              _paid_amount?: number
              _party_name: string
              _payment_method: string
              _prep_id: string
              _total_amount: number
            }
            Returns: string
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_dm: { Args: { _partner: string }; Returns: string }
      start_pro_trial: { Args: never; Returns: Json }
      storage_upload_within_limits: {
        Args: { _max_bytes?: number; _metadata: Json }
        Returns: boolean
      }
      unsend_request_prep: { Args: { _prep_id: string }; Returns: Json }
      unsend_request_prep_check: { Args: { _prep_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      chat_delete_action:
        | "for_me"
        | "for_all"
        | "for_me_bulk"
        | "for_all_bulk"
        | "all_mine"
      friend_request_status: "pending" | "accepted" | "rejected" | "cancelled"
      status_visibility: "public" | "friends"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      chat_delete_action: [
        "for_me",
        "for_all",
        "for_me_bulk",
        "for_all_bulk",
        "all_mine",
      ],
      friend_request_status: ["pending", "accepted", "rejected", "cancelled"],
      status_visibility: ["public", "friends"],
    },
  },
} as const
