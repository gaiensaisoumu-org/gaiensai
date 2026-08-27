-- 非公式公開リハーサルを発券なしで一覧表示する設定を追加する。
ALTER TABLE public.ticket_issue_controls
  DROP CONSTRAINT IF EXISTS ticket_issue_controls_rehearsal_invite_mode_check;

ALTER TABLE public.ticket_issue_controls
  ADD CONSTRAINT ticket_issue_controls_rehearsal_invite_mode_check
  CHECK (
    rehearsal_invite_mode = ANY (
      ARRAY[
        'open'::text,
        'only-own'::text,
        'public-rehearsals'::text,
        'self-rehearsals'::text,
        'self-rehearsals-list-only'::text,
        'auto'::text,
        'off'::text
      ]
    )
  );
