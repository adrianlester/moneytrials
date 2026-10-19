-- The Season — Phase 1 schema.
-- All money is stored as INTEGER PENCE. Never floats: a budgeting game that
-- loses a penny to rounding teaches the wrong lesson.

CREATE TABLE IF NOT EXISTS season (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  start_date        DATE        NOT NULL,
  weeks             INTEGER     NOT NULL DEFAULT 12,
  charity_frequency TEXT        NOT NULL DEFAULT 'normal'
                    CHECK (charity_frequency IN ('sparse','normal','generous')),
  payday_weekday    INTEGER     NOT NULL DEFAULT 6,   -- 0=Sun .. 6=Sat
  status            TEXT        NOT NULL DEFAULT 'setup'
                    CHECK (status IN ('setup','running','paused','ended')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID REFERENCES season(id) ON DELETE CASCADE,
  display_name  TEXT        NOT NULL,
  pin_hash      TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  deck_id       TEXT        NOT NULL DEFAULT 'standard',
  base_wage     INTEGER     NOT NULL DEFAULT 9500,
  wage_variance BOOLEAN     NOT NULL DEFAULT TRUE,
  craft         TEXT,
  setup_done    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, display_name)
);

-- Envelope rules live in data, not in scattered if-statements, so that the
-- "giving is never raidable" rule has exactly one place it can be got wrong.
CREATE TABLE IF NOT EXISTS envelope (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK (type IN ('bills','goals','enjoyment','committed_giving','giving_reserve')),
  balance   INTEGER NOT NULL DEFAULT 0,
  locked    BOOLEAN NOT NULL DEFAULT FALSE,
  raidable  BOOLEAN NOT NULL DEFAULT TRUE,
  rolls_over BOOLEAN NOT NULL DEFAULT TRUE,
  zero_since DATE,                    -- drives the Enjoyment depletion rule
  UNIQUE (player_id, type)
);

CREATE TABLE IF NOT EXISTS cause (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID REFERENCES season(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_custom  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES player(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS commitment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  cause_id     UUID REFERENCES cause(id) ON DELETE SET NULL,
  amount       INTEGER NOT NULL DEFAULT 0,
  locked_until DATE,
  UNIQUE (player_id)
);

CREATE TABLE IF NOT EXISTS goal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  target_amount INTEGER NOT NULL,
  saved_amount  INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  reached_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS week (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  opens_at   DATE NOT NULL,
  closes_at  DATE NOT NULL,
  UNIQUE (season_id, idx)
);

-- The wage roll is per player: income is lumpy and decks can differ.
CREATE TABLE IF NOT EXISTS wage_roll (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  week_id   UUID NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  amount    INTEGER NOT NULL,
  band      TEXT NOT NULL CHECK (band IN ('base','reduced','boosted','zero')),
  allocated BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (player_id, week_id)
);

CREATE TABLE IF NOT EXISTS allocation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  week_id     UUID NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  envelope_id UUID NOT NULL REFERENCES envelope(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  UNIQUE (player_id, week_id, envelope_id)
);

CREATE TABLE IF NOT EXISTS event_card (
  id            TEXT PRIMARY KEY,
  deck_id       TEXT NOT NULL DEFAULT 'standard',
  kind          TEXT NOT NULL CHECK (kind IN ('dilemma','event')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  options_json  TEXT NOT NULL,
  weight        INTEGER NOT NULL DEFAULT 1,
  season_window TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS event_inst (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id      UUID NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  card_id      TEXT NOT NULL REFERENCES event_card(id),
  player_id    UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  choice       TEXT,
  outcome_json TEXT,
  resolved_at  TIMESTAMPTZ,
  UNIQUE (player_id, day)
);

CREATE TABLE IF NOT EXISTS ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  week_id     UUID REFERENCES week(id) ON DELETE SET NULL,
  day         DATE NOT NULL,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL,   -- signed: +in, -out
  envelope_id UUID REFERENCES envelope(id) ON DELETE SET NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS week_result (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  week_id    UUID NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  survived   BOOLEAN NOT NULL,
  failures   TEXT NOT NULL DEFAULT '[]',
  streak     INTEGER NOT NULL DEFAULT 0,
  points     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_id, week_id)
);

CREATE INDEX IF NOT EXISTS ledger_player_day ON ledger (player_id, day);
CREATE INDEX IF NOT EXISTS event_inst_player_day ON event_inst (player_id, day);

-- Added 18 Sep. Cards are shared by both players (the comparison view depends on
-- that), but the detail that makes a card land is personal — Robin's yarn is
-- Sam's baking ingredients. A variant overrides the text of the SAME card for a
-- given craft, so both players still get the same beat on the same day.
ALTER TABLE event_card ADD COLUMN IF NOT EXISTS variants_json TEXT;

-- ------------------------------------------------------------------ evenings
-- Added 21 Sep (Phase 2). Spec §6: five evenings a week, allocated on payday
-- alongside the money. This is what stops the season being solvable on money
-- alone — an evening spent is an evening not spent on something else, and that
-- is the only cost in the game the player can feel rather than count.
--
-- Slots are 1..5 and map to the first five days of the game week in order, so
-- an evening has a date and a card can take one off you.
CREATE TABLE IF NOT EXISTS evening_plan (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID    NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  week_id     UUID    NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  day         DATE    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('shift','making','going_out','nothing')),
  -- Going out costs a rolled amount the player does not know when they plan it.
  -- Budgeting under uncertainty is the point; the range is shown, not the figure.
  planned_cost INTEGER NOT NULL DEFAULT 0,
  actual_cost  INTEGER NOT NULL DEFAULT 0,
  earned       INTEGER NOT NULL DEFAULT 0,
  -- Set when an event card consumes this evening. The player is told what they
  -- lost, per §6: "handle gracefully".
  taken_by     TEXT,
  resolved_at  TIMESTAMPTZ,
  UNIQUE (player_id, week_id, slot)
);

CREATE INDEX IF NOT EXISTS evening_player_day ON evening_plan (player_id, day);

-- Whether this week's five evenings have been planned. Separate from
-- wage_roll.allocated: the money gate and the time gate are different gates,
-- and a season restored mid-week must be able to tell them apart.
ALTER TABLE wage_roll ADD COLUMN IF NOT EXISTS evenings_planned BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------------- hustle
-- Added 6 Oct (Phase 2, second half). Spec §7: supplies -> making evenings ->
-- stock -> market day. The ledger stays the source of truth for money; these
-- tables hold the physical things (batches, stock) that money turns into.
CREATE TABLE IF NOT EXISTS hustle_supply (
  player_id UUID PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
  batches   INTEGER NOT NULL DEFAULT 0
);

-- One project at a time: a multi-evening item is started, then continued by each
-- later Making evening until it is done.
CREATE TABLE IF NOT EXISTS hustle_project (
  player_id     UUID PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
  item          TEXT    NOT NULL,
  evenings_done INTEGER NOT NULL DEFAULT 0,
  started_on    DATE    NOT NULL
);

CREATE TABLE IF NOT EXISTS market_day (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID    NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  day         DATE    NOT NULL,
  band        TEXT    NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 0,
  sold        INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, day)
);

-- A row is one item. status 'sold' with dest NULL is a sale waiting on the
-- player's choice of where the money goes — decided AFTER the amount is known.
CREATE TABLE IF NOT EXISTS stock_item (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID    NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  item       TEXT    NOT NULL,
  price      INTEGER NOT NULL,
  made_on    DATE    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'stock' CHECK (status IN ('stock','sold')),
  market_id  UUID REFERENCES market_day(id) ON DELETE SET NULL,
  dest       TEXT CHECK (dest IN ('me','giving')),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stock_player_status ON stock_item (player_id, status);

ALTER TABLE evening_plan ADD COLUMN IF NOT EXISTS made_item TEXT
;

-- Added 6 Oct. The day-rollover cron resolves evenings, markets and weeks while
-- nobody is looking, so what the player would have been told on arrival has to be
-- kept until they next open the app. Shown once on the home page, then marked seen.
CREATE TABLE IF NOT EXISTS notice (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  text       TEXT NOT NULL,
  seen_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notice_player_unseen ON notice (player_id) WHERE seen_at IS NULL
;

-- Added 6 Oct. A goal that has been funded can be BOUGHT: the price leaves the Goals
-- pot, the goal is kept as something owned, and the pot starts filling the next one.
ALTER TABLE goal ADD COLUMN IF NOT EXISTS bought_at TIMESTAMPTZ
;

-- Added 6 Oct. A card can book an extra market (a school fair, the Christmas market)
-- on top of the weekly one. boost scales the day's buyers, as a percentage.
CREATE TABLE IF NOT EXISTS extra_market (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID    NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  day        DATE    NOT NULL,
  boost      INTEGER NOT NULL DEFAULT 130,
  source     TEXT    NOT NULL DEFAULT '',
  UNIQUE (player_id, day)
)
;

-- Added 12 Oct (Phase 3, asks). Spec section 8. An ask is shared: both players see the same
-- one on the same day, and each answers from their own Giving Reserve. Declining is a
-- recorded answer with no penalty. A key keeps laying out the season's asks idempotent.
CREATE TABLE IF NOT EXISTS ask (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  kind      TEXT NOT NULL,   -- scheduled | unannounced | fundraiser
  day       DATE NOT NULL,
  closes    DATE NOT NULL,
  cause     TEXT NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  suggested TEXT NOT NULL DEFAULT '[]',
  UNIQUE (season_id, key)
)
;

CREATE TABLE IF NOT EXISTS ask_response (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id       UUID NOT NULL REFERENCES ask(id) ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  amount_given INTEGER NOT NULL DEFAULT 0,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ask_id, player_id)
)
;

-- Added 12 Oct (Phase 3, fundraisers). A fundraiser is a player's own cause. It reaches the
-- other player as an ask of kind 'fundraiser' (from_player is hidden from its owner), so
-- sponsoring goes through the same Giving Reserve path and the same ledger. The raised total is
-- the sum of the answers to that ask. Kind started life as a CHECK of two values.
ALTER TABLE ask DROP CONSTRAINT IF EXISTS ask_kind_check
;
ALTER TABLE ask ADD COLUMN IF NOT EXISTS from_player UUID REFERENCES player(id) ON DELETE CASCADE
;
CREATE TABLE IF NOT EXISTS fundraiser (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  ask_id     UUID NOT NULL REFERENCES ask(id) ON DELETE CASCADE,
  cause      TEXT NOT NULL,
  why        TEXT NOT NULL DEFAULT '',
  target     INTEGER NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('event','sales')),
  started_on DATE NOT NULL
)

;

-- Added 12 Oct. A sale can be sent to the player's own fundraiser (method 'sales'). The money
-- is given away at once, so it counts toward the raised total and never enters an envelope.
ALTER TABLE stock_item DROP CONSTRAINT IF EXISTS stock_item_dest_check
;
ALTER TABLE stock_item ADD COLUMN IF NOT EXISTS fundraiser_id UUID REFERENCES fundraiser(id) ON DELETE SET NULL

;

-- Added 12 Oct (Phase 4). Season pause: the day it was paused, so resuming can push the
-- unstarted weeks out by the same amount.
ALTER TABLE season ADD COLUMN IF NOT EXISTS paused_on DATE
;

-- Loans. requested -> offered (admin sets terms) -> active (player accepts) -> repaid.
-- A request can end as declined, by the admin or by the player turning down the terms.
-- No interest: the lesson is the repayment, not the arithmetic of compounding (spec section 13).
CREATE TABLE IF NOT EXISTS loan (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','offered','active','repaid','declined')),
  asked_amount     INTEGER NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  principal        INTEGER NOT NULL DEFAULT 0,
  weekly_repayment INTEGER NOT NULL DEFAULT 0,
  weeks            INTEGER NOT NULL DEFAULT 0,
  outstanding      INTEGER NOT NULL DEFAULT 0,
  requested_on     DATE NOT NULL,
  decided_on       DATE,
  accepted_on      DATE
)
;

-- A change to the locked Committed Giving amount needs the admin's approval (spec section 5).
CREATE TABLE IF NOT EXISTS commitment_request (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  new_amount   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  requested_on DATE NOT NULL,
  decided_on   DATE
)
;

-- The admin adds to a fundraiser's total. Not a player's money, so it is not in any ledger.
CREATE TABLE IF NOT EXISTS fundraiser_match (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id UUID NOT NULL REFERENCES fundraiser(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,
  day           DATE NOT NULL
)
