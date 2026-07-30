-- Video Review — frame drawing on comments.
-- A comment may carry a freehand annotation drawn over the paused frame, stored
-- as normalized strokes: { strokes: [{ color, width, points: [[nx,ny],...] }] }
-- with coordinates in 0..1 so they scale to any player size.
alter table public.app_video_review_comments
    add column if not exists drawing jsonb;
alter table public.app_video_review_comments
    drop constraint if exists app_video_review_comments_drawing_check;
alter table public.app_video_review_comments
    add constraint app_video_review_comments_drawing_check
    check (drawing is null or jsonb_typeof(drawing) = 'object');
