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
          category: string;
          created_at: string;
          edition: string | null;
          id: string;
          notes: string | null;
          shelf_row: number | null;
          spine_color: string | null;
          title: string;
        };
        Insert: {
          author: string;
          category: string;
          created_at?: string;
          edition?: string | null;
          id?: string;
          notes?: string | null;
          shelf_row?: number | null;
          spine_color?: string | null;
          title: string;
        };
        Update: {
          author?: string;
          category?: string;
          created_at?: string;
          edition?: string | null;
          id?: string;
          notes?: string | null;
          shelf_row?: number | null;
          spine_color?: string | null;
          title?: string;
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
