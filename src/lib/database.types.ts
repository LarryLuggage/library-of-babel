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
      books: {
        Row: {
          author: string;
          book_key: string | null;
          category: string;
          created_at: string;
          date_finished: string | null;
          date_started: string | null;
          edition: string | null;
          id: string;
          loaned_to: string | null;
          notes: string | null;
          personal_notes: string | null;
          position: string | null;
          publish_year: number | null;
          rating: number | null;
          reading_status: "unread" | "reading" | "finished" | "dnf";
          shelf_row: number | null;
          spine_color: string | null;
          sub_category: string | null;
          summary: string | null;
          tags: string[];
          title: string;
          top_category: string | null;
          updated_at: string;
        };
        Insert: {
          author: string;
          book_key?: string | null;
          category: string;
          created_at?: string;
          date_finished?: string | null;
          date_started?: string | null;
          edition?: string | null;
          id?: string;
          loaned_to?: string | null;
          notes?: string | null;
          personal_notes?: string | null;
          position?: string | null;
          publish_year?: number | null;
          rating?: number | null;
          reading_status?: "unread" | "reading" | "finished" | "dnf";
          shelf_row?: number | null;
          spine_color?: string | null;
          sub_category?: string | null;
          summary?: string | null;
          tags?: string[];
          title: string;
          top_category?: string | null;
          updated_at?: string;
        };
        Update: {
          author?: string;
          book_key?: string | null;
          category?: string;
          created_at?: string;
          date_finished?: string | null;
          date_started?: string | null;
          edition?: string | null;
          id?: string;
          loaned_to?: string | null;
          notes?: string | null;
          personal_notes?: string | null;
          position?: string | null;
          publish_year?: number | null;
          rating?: number | null;
          reading_status?: "unread" | "reading" | "finished" | "dnf";
          shelf_row?: number | null;
          spine_color?: string | null;
          sub_category?: string | null;
          summary?: string | null;
          tags?: string[];
          title?: string;
          top_category?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      book_connections: {
        Row: {
          connection_type: string;
          created_at: string;
          description: string | null;
          id: string;
          source_book_id: string;
          target_book_id: string;
          weight: number | null;
        };
        Insert: {
          connection_type: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          source_book_id: string;
          target_book_id: string;
          weight?: number | null;
        };
        Update: {
          connection_type?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          source_book_id?: string;
          target_book_id?: string;
          weight?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "book_connections_source_book_id_fkey";
            columns: ["source_book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "book_connections_target_book_id_fkey";
            columns: ["target_book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
