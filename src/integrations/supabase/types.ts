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
          contact: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
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
          user_id?: string
        }
        Relationships: []
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
          cron_secret: string | null
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          cron_secret?: string | null
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          cron_secret?: string | null
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
          created_at: string
          customer_id: string | null
          id: string
          item_id: string
          note: string | null
          price_per_unit: number | null
          qty: number
          qty_mode: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id: string
          note?: string | null
          price_per_unit?: number | null
          qty: number
          qty_mode: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          item_id?: string
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
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_health: { Args: never; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
