create table if not exists public.book_quotes (
    id uuid primary key default gen_random_uuid(),
    book_id uuid not null references public.books(id) on delete cascade,
    quote_text text not null check (char_length(btrim(quote_text)) > 0),
    page_number text,
    chapter text,
    note text,
    tags text[] not null default '{}',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists book_quotes_book_id_idx
    on public.book_quotes (book_id);

create index if not exists book_quotes_created_at_idx
    on public.book_quotes (created_at desc);

alter table public.book_quotes enable row level security;

create table if not exists public.reading_lists (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null check (char_length(btrim(name)) > 0),
    description text,
    is_queue boolean not null default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.reading_lists enable row level security;

create table if not exists public.reading_list_items (
    id uuid primary key default gen_random_uuid(),
    list_id uuid not null references public.reading_lists(id) on delete cascade,
    book_id uuid not null references public.books(id) on delete cascade,
    position integer not null default 0 check (position >= 0),
    note text,
    added_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_reading_list_book unique (list_id, book_id)
);

create index if not exists reading_list_items_list_pos_idx
    on public.reading_list_items (list_id, position, added_at);

create index if not exists reading_list_items_book_id_idx
    on public.reading_list_items (book_id);

alter table public.reading_list_items enable row level security;
