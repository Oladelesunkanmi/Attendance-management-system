export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          matric_number: string | null;
          full_name: string;
          role: 'student' | 'lecturer';
          created_at: string;
        };
        Insert: {
          id: string;
          matric_number?: string | null;
          full_name: string;
          role: 'student' | 'lecturer';
          created_at?: string;
        };
        Update: {
          id?: string;
          matric_number?: string | null;
          full_name?: string;
          role?: 'student' | 'lecturer';
          created_at?: string;
        };
        Relationships: [];
      };
      courses: {
        Row: {
          id: string;
          code: string;
          title: string;
          lecturer_id: string | null;
          min_attendance_pct: number;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          lecturer_id?: string | null;
          min_attendance_pct?: number;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          lecturer_id?: string | null;
          min_attendance_pct?: number;
        };
        Relationships: [];
      };
      enrollments: {
        Row: {
          id: string;
          course_id: string;
          student_id: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          student_id: string;
        };
        Update: {
          id?: string;
          course_id?: string;
          student_id?: string;
        };
        Relationships: [];
      };
      venues: {
        Row: {
          id: string;
          name: string;
          latitude: number;
          longitude: number;
          radius_meters: number;
        };
        Insert: {
          id?: string;
          name: string;
          latitude: number;
          longitude: number;
          radius_meters?: number;
        };
        Update: {
          id?: string;
          name?: string;
          latitude?: number;
          longitude?: number;
          radius_meters?: number;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          course_id: string;
          venue_id: string | null;
          started_at: string;
          ended_at: string | null;
          is_active: boolean;
          verification_mode: 'qr_only' | 'qr_geofence' | 'full';
        };
        Insert: {
          id?: string;
          course_id: string;
          venue_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          is_active?: boolean;
          verification_mode?: 'qr_only' | 'qr_geofence' | 'full';
        };
        Update: {
          id?: string;
          course_id?: string;
          venue_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          is_active?: boolean;
          verification_mode?: 'qr_only' | 'qr_geofence' | 'full';
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          session_id: string;
          student_id: string;
          latitude: number;
          longitude: number;
          distance_meters: number;
          gps_accuracy_meters: number | null;
          webauthn_verified: boolean;
          flagged_reason: string | null;
          checked_in_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          student_id: string;
          latitude: number;
          longitude: number;
          distance_meters: number;
          gps_accuracy_meters?: number | null;
          webauthn_verified?: boolean;
          flagged_reason?: string | null;
          checked_in_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          student_id?: string;
          latitude?: number;
          longitude?: number;
          distance_meters?: number;
          gps_accuracy_meters?: number | null;
          webauthn_verified?: boolean;
          flagged_reason?: string | null;
          checked_in_at?: string;
        };
        Relationships: [];
      };
      webauthn_credentials: {
        Row: {
          id: string;
          student_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          aaguid: string | null;
          device_attestation_id: string | null;
          enrolled_by: string | null;
          enrolled_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          aaguid?: string | null;
          device_attestation_id?: string | null;
          enrolled_by?: string | null;
          enrolled_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Update: {
          id?: string;
          student_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          aaguid?: string | null;
          device_attestation_id?: string | null;
          enrolled_by?: string | null;
          enrolled_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Relationships: [];
      };
      enrolment_pins: {
        Row: {
          id: string;
          pin: string;
          lecturer_id: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          pin: string;
          lecturer_id: string;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          pin?: string;
          lecturer_id?: string;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Session = Database['public']['Tables']['sessions']['Row'];
export type AttendanceRecord = Database['public']['Tables']['attendance_records']['Row'];

/**
 * Returned by `.select('*, profiles(full_name, matric_number)')` on attendance_records.
 * The `profiles` field is the nested join result and may be null if the profile
 * is missing (e.g. profile_creation_errors case).
 */
export type AttendanceWithProfile = AttendanceRecord & {
  profiles: {
    full_name: string;
    matric_number: string | null;
  } | null;
};
