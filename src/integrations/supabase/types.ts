export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: { Row: any; Insert: any; Update: any };
      user_roles: { Row: any; Insert: any; Update: any };
      trucks: { Row: any; Insert: any; Update: any };
      docks: { Row: any; Insert: any; Update: any };
      yard_slots: { Row: any; Insert: any; Update: any };
      trailer_moves: { Row: any; Insert: any; Update: any };
      tasks: { Row: any; Insert: any; Update: any };
      task_events: { Row: any; Insert: any; Update: any };
      parking_queue: { Row: any; Insert: any; Update: any };
      appointment_qr_tokens: { Row: any; Insert: any; Update: any };
      dock_appointments: { Row: any; Insert: any; Update: any };
      email_notifications: { Row: any; Insert: any; Update: any };
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: { Args: { _user_id: string; _role: string }; Returns: boolean };
      auto_assign_yard_slot: { Args: { _truck_id: string; _actor?: string }; Returns: Json };
      promote_parking_queue: { Args: { _actor?: string }; Returns: Json };
    }
    Enums: {
      app_role: "admin" | "operator" | "driver" | "guard"
      carrier_category: "standard" | "refrigerated" | "hazmat" | "oversize" | "express" | "container"
      move_action: "assign" | "relocate" | "release" | "reserve" | "out_of_service"
      task_event_type: "created" | "assigned" | "started" | "completed" | "cancelled" | "note"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
