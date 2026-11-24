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
      book_quotes: {
        Row: {
          book_id: string;
          chapter: string | null;
          created_at: string;
          id: string;
          note: string | null;
          page_number: string | null;
          quote_text: string;
          tags: string[];
          updated_at: string;
        };
        Insert: {
          book_id: string;
          chapter?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          page_number?: string | null;
          quote_text: string;
          tags?: string[];
          updated_at?: string;
        };
        Update: {
          book_id?: string;
          chapter?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          page_number?: string | null;
          quote_text?: string;
          tags?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "book_quotes_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
        ];
      };
      reading_lists: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_queue: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_queue?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_queue?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reading_list_items: {
        Row: {
          added_at: string;
          book_id: string;
          id: string;
          list_id: string;
          note: string | null;
          position: number;
        };
        Insert: {
          added_at?: string;
          book_id: string;
          id?: string;
          list_id: string;
          note?: string | null;
          position?: number;
        };
        Update: {
          added_at?: string;
          book_id?: string;
          id?: string;
          list_id?: string;
          note?: string | null;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "reading_list_items_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "reading_lists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reading_list_items_book_id_fkey";
            columns: ["book_id"];
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
