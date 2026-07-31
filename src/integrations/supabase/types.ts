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
      booking_payments: {
        Row: {
          account_id: string | null
          amount_charged_gbp: number
          amount_outstanding_gbp: number | null
          booking_group_id: string
          created_at: string | null
          discount_gbp: number | null
          id: string
          metadata: Json | null
          paid_at: string | null
          payment_option: string
          receipt_pdf_path: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          subtotal_gbp: number
          total_gbp: number
          vat_gbp: number
        }
        Insert: {
          account_id?: string | null
          amount_charged_gbp: number
          amount_outstanding_gbp?: number | null
          booking_group_id: string
          created_at?: string | null
          discount_gbp?: number | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          payment_option: string
          receipt_pdf_path?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          subtotal_gbp: number
          total_gbp: number
          vat_gbp: number
        }
        Update: {
          account_id?: string | null
          amount_charged_gbp?: number
          amount_outstanding_gbp?: number | null
          booking_group_id?: string
          created_at?: string | null
          discount_gbp?: number | null
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          payment_option?: string
          receipt_pdf_path?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          subtotal_gbp?: number
          total_gbp?: number
          vat_gbp?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          account_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          account_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          account_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_members: {
        Row: {
          account_id: string
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string
          last_login_at: string | null
          last_login_ip: string | null
          pin_colour: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          last_login_at?: string | null
          last_login_ip?: string | null
          pin_colour?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string
          last_login_at?: string | null
          last_login_ip?: string | null
          pin_colour?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_user_audit: {
        Row: {
          account_id: string
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          target_email: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          account_id: string
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_email?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_email?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_user_audit_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: string
          agreement_acknowledged_at: string | null
          agreement_acknowledged_version: string | null
          airtable_client_id: string | null
          booking_mode: string
          building_number: string | null
          city: string | null
          client_code: string | null
          company_name: string
          country: string | null
          created_at: string
          id: string
          owner_user_id: string
          postcode: string | null
          registration_number: string | null
          street_name: string | null
          updated_at: string
        }
        Insert: {
          account_type?: string
          agreement_acknowledged_at?: string | null
          agreement_acknowledged_version?: string | null
          airtable_client_id?: string | null
          booking_mode?: string
          building_number?: string | null
          city?: string | null
          client_code?: string | null
          company_name: string
          country?: string | null
          created_at?: string
          id?: string
          owner_user_id: string
          postcode?: string | null
          registration_number?: string | null
          street_name?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          agreement_acknowledged_at?: string | null
          agreement_acknowledged_version?: string | null
          airtable_client_id?: string | null
          booking_mode?: string
          building_number?: string | null
          city?: string | null
          client_code?: string | null
          company_name?: string
          country?: string | null
          created_at?: string
          id?: string
          owner_user_id?: string
          postcode?: string | null
          registration_number?: string | null
          street_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          actor_name: string | null
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          project_id: string | null
          project_name: string | null
          round_id: string | null
          round_number: number | null
          scene_id: string | null
          scene_name: string | null
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          project_name?: string | null
          round_id?: string | null
          round_number?: number | null
          scene_id?: string | null
          scene_name?: string | null
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          project_name?: string | null
          round_id?: string | null
          round_number?: number | null
          scene_id?: string | null
          scene_name?: string | null
        }
        Relationships: []
      }
      activity_log_dismissals: {
        Row: {
          activity_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_dismissals_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activity_log"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_audit_log: {
        Row: {
          accepted_at: string
          account_id: string | null
          agreement_id: string | null
          agreement_uid: string | null
          agreement_version: string
          checkbox_text: string
          created_at: string
          id: string
          ip_address: string | null
          pdf_sha256: string | null
          storage_path: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          account_id?: string | null
          agreement_id?: string | null
          agreement_uid?: string | null
          agreement_version: string
          checkbox_text: string
          created_at?: string
          id?: string
          ip_address?: string | null
          pdf_sha256?: string | null
          storage_path?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          account_id?: string | null
          agreement_id?: string | null
          agreement_uid?: string | null
          agreement_version?: string
          checkbox_text?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          pdf_sha256?: string | null
          storage_path?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agreement_terms_versions: {
        Row: {
          content: string
          created_at: string
          effective_at: string
          id: string
          is_current: boolean
          title: string
          version_code: string
        }
        Insert: {
          content: string
          created_at?: string
          effective_at?: string
          id?: string
          is_current?: boolean
          title: string
          version_code: string
        }
        Update: {
          content?: string
          created_at?: string
          effective_at?: string
          id?: string
          is_current?: boolean
          title?: string
          version_code?: string
        }
        Relationships: []
      }
      agreements: {
        Row: {
          accepted_at: string
          accepted_by_email: string | null
          accepted_by_name: string | null
          account_id: string | null
          agreement_uid: string | null
          agreement_version: string
          checkbox_text: string | null
          company_name: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          ip_address: string | null
          pdf_sha256: string | null
          signatory_name: string | null
          signatory_position: string | null
          signed_at: string
          storage_path: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          accepted_by_email?: string | null
          accepted_by_name?: string | null
          account_id?: string | null
          agreement_uid?: string | null
          agreement_version?: string
          checkbox_text?: string | null
          company_name: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          ip_address?: string | null
          pdf_sha256?: string | null
          signatory_name?: string | null
          signatory_position?: string | null
          signed_at?: string
          storage_path: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          accepted_by_email?: string | null
          accepted_by_name?: string | null
          account_id?: string | null
          agreement_uid?: string | null
          agreement_version?: string
          checkbox_text?: string | null
          company_name?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          ip_address?: string | null
          pdf_sha256?: string | null
          signatory_name?: string | null
          signatory_position?: string | null
          signed_at?: string
          storage_path?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      amount_adjustments: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          is_acknowledged: boolean
          new_amount: number
          previous_amount: number
          quotation_id: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          is_acknowledged?: boolean
          new_amount: number
          previous_amount: number
          quotation_id?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          is_acknowledged?: boolean
          new_amount?: number
          previous_amount?: number
          quotation_id?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amount_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amount_adjustments_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      asset_approvals: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_approvals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "round_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_comments: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          message: string
          parent_comment_id: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          message: string
          parent_comment_id?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          message?: string
          parent_comment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_comments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "round_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "asset_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_drawings: {
        Row: {
          asset_id: string
          color: string
          created_at: string
          created_by: string
          id: string
          points: Json
          scene_round_id: string
        }
        Insert: {
          asset_id: string
          color?: string
          created_at?: string
          created_by: string
          id?: string
          points: Json
          scene_round_id: string
        }
        Update: {
          asset_id?: string
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          points?: Json
          scene_round_id?: string
        }
        Relationships: []
      }
      asset_pin_messages: {
        Row: {
          attachments: Json
          body: string | null
          created_at: string
          id: string
          pin_id: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          body?: string | null
          created_at?: string
          id?: string
          pin_id: string
          user_id: string
        }
        Update: {
          attachments?: Json
          body?: string | null
          created_at?: string
          id?: string
          pin_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_pin_messages_pin_id_fkey"
            columns: ["pin_id"]
            isOneToOne: false
            referencedRelation: "asset_pins"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_pins: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          id: string
          resolved_at: string | null
          scene_round_id: string
          x: number
          y: number
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by: string
          id?: string
          resolved_at?: string | null
          scene_round_id: string
          x: number
          y: number
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          id?: string
          resolved_at?: string | null
          scene_round_id?: string
          x?: number
          y?: number
        }
        Relationships: []
      }
      client_activity: {
        Row: {
          actor_name: string | null
          actor_role: string | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          id: string
          kind: string
          metadata: Json
          path: string | null
          session_id: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          kind: string
          metadata?: Json
          path?: string | null
          session_id?: string | null
          started_at?: string
          user_id: string
        }
        Update: {
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          path?: string | null
          session_id?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_notifications: {
        Row: {
          account_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          kind: string
          link_path: string | null
          message: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind: string
          link_path?: string | null
          message?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind?: string
          link_path?: string | null
          message?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      dropbox_connections: {
        Row: {
          access_token: string
          account_id: string | null
          created_at: string
          cursor: string | null
          id: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_id?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_id?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
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
      folder_mappings: {
        Row: {
          created_at: string
          dropbox_folder_path: string
          id: string
          project_id: string | null
          scene_id: string | null
        }
        Insert: {
          created_at?: string
          dropbox_folder_path: string
          id?: string
          project_id?: string | null
          scene_id?: string | null
        }
        Update: {
          created_at?: string
          dropbox_folder_path?: string
          id?: string
          project_id?: string | null
          scene_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folder_mappings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folder_mappings_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      freelancer_agreements: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          signatory_name: string | null
          signed_at: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          signatory_name?: string | null
          signed_at?: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          signatory_name?: string | null
          signed_at?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      freelancer_documents: {
        Row: {
          account_id: string | null
          created_at: string | null
          document_type: string
          id: string
          pdf_url: string | null
          profile_id: string | null
          signed_at: string | null
          signed_by_name: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          document_type: string
          id?: string
          pdf_url?: string | null
          profile_id?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          document_type?: string
          id?: string
          pdf_url?: string | null
          profile_id?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "freelancer_documents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "freelancer_documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "freelancer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      freelancer_profiles: {
        Row: {
          account_holder: string | null
          account_number: string | null
          address: string | null
          bank_name: string | null
          city: string | null
          country: string | null
          created_at: string
          day_rate: number | null
          email: string
          first_name: string
          flat_number: string | null
          house_number: string | null
          id: string
          last_name: string
          postcode: string | null
          rate_currency: string | null
          rate_period: string | null
          role: string | null
          sort_code: string | null
          street_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          address?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          day_rate?: number | null
          email: string
          first_name: string
          flat_number?: string | null
          house_number?: string | null
          id?: string
          last_name: string
          postcode?: string | null
          rate_currency?: string | null
          rate_period?: string | null
          role?: string | null
          sort_code?: string | null
          street_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          address?: string | null
          bank_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          day_rate?: number | null
          email?: string
          first_name?: string
          flat_number?: string | null
          house_number?: string | null
          id?: string
          last_name?: string
          postcode?: string | null
          rate_currency?: string | null
          rate_period?: string | null
          role?: string | null
          sort_code?: string | null
          street_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          account_id: string | null
          amount: number
          bank_account: string
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_number: string | null
          issued_at: string | null
          line_items: Json
          notes: string | null
          paid_at: string | null
          project_id: string | null
          quotation_id: string | null
          reference_number: string
          revolut_checkout_url: string | null
          revolut_order_id: string | null
          sent_at: string | null
          status: string
          stripe_checkout_url: string | null
          stripe_payment_intent_id: string | null
          subtotal: number | null
          type: string
          updated_at: string
          user_id: string
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          account_id?: string | null
          amount: number
          bank_account?: string
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          line_items?: Json
          notes?: string | null
          paid_at?: string | null
          project_id?: string | null
          quotation_id?: string | null
          reference_number: string
          revolut_checkout_url?: string | null
          revolut_order_id?: string | null
          sent_at?: string | null
          status?: string
          stripe_checkout_url?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          type?: string
          updated_at?: string
          user_id: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          account_id?: string | null
          amount?: number
          bank_account?: string
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          line_items?: Json
          notes?: string | null
          paid_at?: string | null
          project_id?: string | null
          quotation_id?: string | null
          reference_number?: string
          revolut_checkout_url?: string | null
          revolut_order_id?: string | null
          sent_at?: string | null
          status?: string
          stripe_checkout_url?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          type?: string
          updated_at?: string
          user_id?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotation_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lane_tasks: {
        Row: {
          account_id: string
          attachments: Json
          completed_at: string | null
          created_at: string
          created_by: string
          delivered_at: string | null
          delivery_confirmed_at: string | null
          delivery_due_at: string | null
          delivery_status: string
          description: string | null
          duration_days: number
          feedback_sketch_url: string | null
          feedback_submitted_at: string | null
          feedback_text: string | null
          id: string
          lane_index: number | null
          notification_sent_at: string | null
          position: number | null
          project_id: string | null
          requested_delivery_date: string | null
          start_date: string | null
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attachments?: Json
          completed_at?: string | null
          created_at?: string
          created_by: string
          delivered_at?: string | null
          delivery_confirmed_at?: string | null
          delivery_due_at?: string | null
          delivery_status?: string
          description?: string | null
          duration_days?: number
          feedback_sketch_url?: string | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          id?: string
          lane_index?: number | null
          notification_sent_at?: string | null
          position?: number | null
          project_id?: string | null
          requested_delivery_date?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attachments?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string
          delivered_at?: string | null
          delivery_confirmed_at?: string | null
          delivery_due_at?: string | null
          delivery_status?: string
          description?: string | null
          duration_days?: number
          feedback_sketch_url?: string | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          id?: string
          lane_index?: number | null
          notification_sent_at?: string | null
          position?: number | null
          project_id?: string | null
          requested_delivery_date?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          id: string
          notify_daily_summary: boolean
          notify_feedback_reminder: boolean
          notify_new_review_item: boolean
          notify_new_round_delivered: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notify_daily_summary?: boolean
          notify_feedback_reminder?: boolean
          notify_new_review_item?: boolean
          notify_new_round_delivered?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notify_daily_summary?: boolean
          notify_feedback_reminder?: boolean
          notify_new_review_item?: boolean
          notify_new_round_delivered?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          accepted_at: string | null
          account_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          invoice_id: string | null
          lines: Json
          notes: string | null
          order_number: string | null
          order_type: string
          status: string
          subtotal: number
          title: string
          total: number
          updated_at: string
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          accepted_at?: string | null
          account_id: string
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          invoice_id?: string | null
          lines?: Json
          notes?: string | null
          order_number?: string | null
          order_type?: string
          status?: string
          subtotal?: number
          title: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          accepted_at?: string | null
          account_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          invoice_id?: string | null
          lines?: Json
          notes?: string | null
          order_number?: string | null
          order_type?: string
          status?: string
          subtotal?: number
          title?: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_id: string | null
          avatar_url: string | null
          company: string | null
          created_at: string
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          position: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          position?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          position?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_id: string | null
          airtable_project_id: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          dropbox_folder: string | null
          dropbox_folder_url: string | null
          id: string
          name: string
          project_code: string | null
          project_slug: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          airtable_project_id?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          dropbox_folder?: string | null
          dropbox_folder_url?: string | null
          id?: string
          name: string
          project_code?: string | null
          project_slug?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          airtable_project_id?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          dropbox_folder?: string | null
          dropbox_folder_url?: string | null
          id?: string
          name?: string
          project_code?: string | null
          project_slug?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_documents: {
        Row: {
          account_id: string
          amount: number
          client_address: string | null
          client_company: string | null
          client_country: string | null
          client_email: string | null
          client_name: string | null
          client_position: string | null
          client_registration: string | null
          created_at: string
          currency: string
          deposit_amount: number | null
          deposit_percentage: number
          gross_total: number | null
          id: string
          issued_at: string | null
          line_items: Json
          net_total: number | null
          notes: string | null
          project_id: string | null
          project_name: string | null
          quotation_number: string
          reference_number: string | null
          sent_at: string | null
          signed_at: string | null
          signed_by_name: string | null
          signed_by_position: string | null
          status: string
          subtotal: number | null
          updated_at: string
          user_id: string
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          account_id: string
          amount?: number
          client_address?: string | null
          client_company?: string | null
          client_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_position?: string | null
          client_registration?: string | null
          created_at?: string
          currency?: string
          deposit_amount?: number | null
          deposit_percentage?: number
          gross_total?: number | null
          id?: string
          issued_at?: string | null
          line_items?: Json
          net_total?: number | null
          notes?: string | null
          project_id?: string | null
          project_name?: string | null
          quotation_number: string
          reference_number?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_by_position?: string | null
          status?: string
          subtotal?: number | null
          updated_at?: string
          user_id: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          account_id?: string
          amount?: number
          client_address?: string | null
          client_company?: string | null
          client_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_position?: string | null
          client_registration?: string | null
          created_at?: string
          currency?: string
          deposit_amount?: number | null
          deposit_percentage?: number
          gross_total?: number | null
          id?: string
          issued_at?: string | null
          line_items?: Json
          net_total?: number | null
          notes?: string | null
          project_id?: string | null
          project_name?: string | null
          quotation_number?: string
          reference_number?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_by_position?: string | null
          status?: string
          subtotal?: number | null
          updated_at?: string
          user_id?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Relationships: []
      }
      quotations: {
        Row: {
          amount: number
          created_at: string
          id: string
          project_id: string | null
          reference_number: string
          signed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          project_id?: string | null
          reference_number: string
          signed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          project_id?: string | null
          reference_number?: string
          signed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      round_assets: {
        Row: {
          content_hash: string | null
          created_at: string
          dropbox_file_id: string | null
          dropbox_path: string | null
          file_size: number | null
          filename: string
          id: string
          is_current: boolean
          scene_round_id: string
          source: string
          storage_path: string | null
          thumbnail_expires_at: string | null
          thumbnail_url: string | null
          updated_at: string
          version: number
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          dropbox_file_id?: string | null
          dropbox_path?: string | null
          file_size?: number | null
          filename: string
          id?: string
          is_current?: boolean
          scene_round_id: string
          source?: string
          storage_path?: string | null
          thumbnail_expires_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          dropbox_file_id?: string | null
          dropbox_path?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          is_current?: boolean
          scene_round_id?: string
          source?: string
          storage_path?: string | null
          thumbnail_expires_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "round_assets_scene_round_id_fkey"
            columns: ["scene_round_id"]
            isOneToOne: false
            referencedRelation: "scene_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      round_uploads: {
        Row: {
          category: string
          created_at: string
          dropbox_shared_url: string | null
          file_name: string
          file_size: number | null
          id: string
          scene_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          dropbox_shared_url?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          scene_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          dropbox_shared_url?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          scene_id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      scene_messages: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          parent_message_id: string | null
          scene_id: string
          sender_type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          parent_message_id?: string | null
          scene_id: string
          sender_type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          parent_message_id?: string | null
          scene_id?: string
          sender_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scene_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "scene_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_messages_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_rounds: {
        Row: {
          approved_at: string | null
          booking_group_id: string | null
          created_by: string | null
          reservation_expires_at: string | null
          round_fee: number | null
          created_at: string
          delivered_at: string | null
          delivery_due_at: string | null
          end_date: string | null
          id: string
          image_url: string | null
          instructions: string | null
          kind: string
          round_number: number
          scene_id: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          booking_group_id?: string | null
          created_by?: string | null
          reservation_expires_at?: string | null
          round_fee?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_due_at?: string | null
          end_date?: string | null
          id?: string
          image_url?: string | null
          instructions?: string | null
          kind?: string
          round_number: number
          scene_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          booking_group_id?: string | null
          created_by?: string | null
          reservation_expires_at?: string | null
          round_fee?: number | null
          created_at?: string
          delivered_at?: string | null
          delivery_due_at?: string | null
          end_date?: string | null
          id?: string
          image_url?: string | null
          instructions?: string | null
          kind?: string
          round_number?: number
          scene_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_rounds_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          airtable_record_id: string | null
          created_at: string
          current_round: number
          dropbox_folder: string | null
          id: string
          name: string
          next_delivery_at: string | null
          paid_rounds: number
          project_id: string
          review_deadline: string | null
          scene_code: string | null
          scene_slug: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          airtable_record_id?: string | null
          created_at?: string
          current_round?: number
          dropbox_folder?: string | null
          id?: string
          name: string
          next_delivery_at?: string | null
          paid_rounds?: number
          project_id: string
          review_deadline?: string | null
          scene_code?: string | null
          scene_slug?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          airtable_record_id?: string | null
          created_at?: string
          current_round?: number
          dropbox_folder?: string | null
          id?: string
          name?: string
          next_delivery_at?: string | null
          paid_rounds?: number
          project_id?: string
          review_deadline?: string | null
          scene_code?: string | null
          scene_slug?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          account_id: string
          active_lanes: number
          cancelled_at: string | null
          created_at: string
          id: string
          lane_change_effective_at: string | null
          lane_change_requested_at: string | null
          monthly_cost_pence: number
          paused_at: string | null
          pending_lane_count: number | null
          pending_monthly_cost_pence: number | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          active_lanes?: number
          cancelled_at?: string | null
          created_at?: string
          id?: string
          lane_change_effective_at?: string | null
          lane_change_requested_at?: string | null
          monthly_cost_pence?: number
          paused_at?: string | null
          pending_lane_count?: number | null
          pending_monthly_cost_pence?: number | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          active_lanes?: number
          cancelled_at?: string | null
          created_at?: string
          id?: string
          lane_change_effective_at?: string | null
          lane_change_requested_at?: string | null
          monthly_cost_pence?: number
          paused_at?: string | null
          pending_lane_count?: number | null
          pending_monthly_cost_pence?: number | null
          started_at?: string
          status?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_account_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          accepted_at: string
          account_id: string
          company_name: string
          email: string
          expires_at: string
          id: string
          revoked_at: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      internal_airtable_sync_headers: {
        Args: { trigger_name: string }
        Returns: Json
      }
      internal_dropbox_trigger_headers: {
        Args: { trigger_name: string }
        Returns: Json
      }
      is_account_member: { Args: { _account_id: string }; Returns: boolean }
      is_account_owner: { Args: { _account_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
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
      scene_dropbox_visuals_path: {
        Args: { p_scene_id: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "client" | "owner" | "user" | "team" | "client_invitee"
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
      app_role: ["admin", "client", "owner", "user", "team", "client_invitee"],
    },
  },
} as const
<claude-code-hint v="1" type="plugin" value="supabase@claude-plugins-official" />
