alter table public.books
    add column if not exists book_key text,
    add column if not exists position text,
    add column if not exists top_category text,
    add column if not exists sub_category text,
    add column if not exists summary text,
    add column if not exists tags text[] not null default '{}',
    add column if not exists publish_year integer,
    add column if not exists reading_status text not null default 'unread'
        check (reading_status in ('unread', 'reading', 'finished', 'dnf')),
    add column if not exists rating smallint
        check (rating is null or (rating between 1 and 5)),
    add column if not exists date_started date,
    add column if not exists date_finished date,
    add column if not exists personal_notes text,
    add column if not exists loaned_to text,
    add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

alter table public.books
    drop constraint if exists unique_book_identity;

create unique index if not exists books_book_key_idx
    on public.books (book_key);

create unique index if not exists books_copy_identity_idx
    on public.books (title, author, coalesce(shelf_row, -1), coalesce(position, ''));

alter table public.book_connections
    drop constraint if exists unique_connection_pair;
