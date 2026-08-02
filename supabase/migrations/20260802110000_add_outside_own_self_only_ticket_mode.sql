ALTER TABLE public.ticket_issue_controls
  DROP CONSTRAINT IF EXISTS ticket_issue_controls_class_invite_mode_check,
  DROP CONSTRAINT IF EXISTS ticket_issue_controls_gym_invite_mode_check;

ALTER TABLE public.ticket_issue_controls
  ADD CONSTRAINT ticket_issue_controls_class_invite_mode_check
    CHECK (
      class_invite_mode = ANY (
        ARRAY['open', 'only-own', 'outside-own-self-only', 'public-rehearsals', 'auto', 'off']
      )
    ),
  ADD CONSTRAINT ticket_issue_controls_gym_invite_mode_check
    CHECK (
      gym_invite_mode = ANY (
        ARRAY['open', 'only-own', 'outside-own-self-only', 'public-rehearsals', 'auto', 'off']
      )
    );
