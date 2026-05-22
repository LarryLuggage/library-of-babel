create extension if not exists "uuid-ossp";

create table public.books (
    id uuid default uuid_generate_v4() primary key,
    title text not null,
    author text not null,
    category text not null,
    edition text,
    spine_color text default '#4a3728',
    shelf_row integer,
    notes text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_book_identity unique (title, author)
);

create index books_search_idx
    on public.books
    using gin(to_tsvector('english', title || ' ' || author));

create table public.book_connections (
    id uuid default uuid_generate_v4() primary key,
    source_book_id uuid references public.books(id) on delete cascade not null,
    target_book_id uuid references public.books(id) on delete cascade not null,
    connection_type text not null,
    description text,
    weight integer default 1,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint no_self_connections check (source_book_id <> target_book_id),
    constraint unique_connection_pair unique(source_book_id, target_book_id)
);

create unique index book_connections_undirected_pair_idx
    on public.book_connections (
        least(source_book_id, target_book_id),
        greatest(source_book_id, target_book_id)
    );

alter table public.books enable row level security;
alter table public.book_connections enable row level security;
