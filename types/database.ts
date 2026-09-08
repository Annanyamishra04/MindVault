/**
 * Hand-maintained types mirroring the Supabase schema defined in
 * supabase/migrations/. In a larger project these would be generated with
 * `supabase gen types typescript`, but are kept explicit here so the
 * schema and the types evolve together in code review.
 */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
        };
        Update: {
          full_name?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          summary: string | null;
          key_points: string[] | null;
          is_favorite: boolean;
          embedding_status: "pending" | "ready" | "stale" | "failed";
          // Phase 7.2 (migration 0008): bumped by a database trigger
          // whenever title/content change; never written directly by
          // application code. See lib/ai/reindex-coordinator.ts and
          // commit_note_embedding()/confirm_note_embedding_ready()
          // below for how this is used to make the final embedding
          // write atomic.
          content_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content?: string;
          summary?: string | null;
          key_points?: string[] | null;
          is_favorite?: boolean;
          embedding_status?: "pending" | "ready" | "stale" | "failed";
        };
        Update: {
          title?: string;
          content?: string;
          summary?: string | null;
          key_points?: string[] | null;
          is_favorite?: boolean;
          embedding_status?: "pending" | "ready" | "stale" | "failed";
        };
        // notes.user_id references auth.users, not public.profiles —
        // there is no FK PostgREST could use to embed `profiles(*)` in
        // a notes query, so this is intentionally empty rather than
        // pointing at a relationship that doesn't exist.
        Relationships: [];
      };
      tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
        };
        Update: {
          name?: string;
        };
        // Same reasoning as notes above: tags.user_id references
        // auth.users, not public.profiles.
        Relationships: [];
      };
      note_tags: {
        Row: {
          note_id: string;
          tag_id: string;
        };
        Insert: {
          note_id: string;
          tag_id: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "note_tags_note_id_fkey";
            columns: ["note_id"];
            referencedRelation: "notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "note_tags_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      note_embeddings: {
        Row: {
          id: string;
          note_id: string;
          user_id: string;
          embedding: number[];
          content_hash: string;
          embedding_model: string;
          embedding_dimensions: number;
          // Phase 7.2 (migration 0008): informational only — notes.content_version
          // at commit time. content_hash remains the actual freshness check.
          note_content_version: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          note_id: string;
          user_id: string;
          embedding: number[];
          content_hash: string;
          embedding_model: string;
          embedding_dimensions: number;
          note_content_version?: number | null;
        };
        Update: {
          embedding?: number[];
          content_hash?: string;
          embedding_model?: string;
          embedding_dimensions?: number;
          note_content_version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "note_embeddings_note_id_fkey";
            columns: ["note_id"];
            referencedRelation: "notes";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_notes: {
        Args: {
          query_embedding: number[];
          match_user_id: string;
          match_embedding_model: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          note_id: string;
          title: string;
          content: string;
          summary: string | null;
          similarity: number;
        }[];
      };
      match_related_notes: {
        Args: {
          target_note_id: string;
          match_user_id: string;
          match_embedding_model: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          note_id: string;
          title: string;
          summary: string | null;
          similarity: number;
        }[];
      };
      search_note_ids: {
        Args: {
          search_pattern: string;
        };
        Returns: {
          note_id: string;
        }[];
      };
      get_or_create_tag: {
        Args: {
          p_name: string;
        };
        Returns: {
          id: string;
          name: string;
        }[];
      };
      create_note_with_tags: {
        Args: {
          p_title: string;
          p_content: string;
          p_is_favorite: boolean;
          p_tag_names: string[];
        };
        Returns: string;
      };
      // Phase 7.2 (migration 0008): the atomic write-time commit. Returns
      // false (not an error) when p_expected_version no longer matches
      // the note's current content_version — see reindex-coordinator.ts.
      commit_note_embedding: {
        Args: {
          p_note_id: string;
          p_expected_version: number;
          p_content_hash: string;
          p_embedding: number[];
          p_embedding_model: string;
          p_embedding_dimensions: number;
        };
        Returns: boolean;
      };
      // Phase 7.2 (migration 0008): the atomic skip-path commit, used
      // when a stored embedding is already current and only the status
      // flag needs to (re-)become 'ready'.
      confirm_note_embedding_ready: {
        Args: {
          p_note_id: string;
          p_expected_version: number;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Note = Database["public"]["Tables"]["notes"]["Row"];
export type Tag = Database["public"]["Tables"]["tags"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
