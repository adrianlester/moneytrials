/**
 * Giving asks as data (spec section 8). Scheduled asks sit on the calendar and can be saved
 * toward; unannounced ones arrive with no warning. Amounts are pence.
 *
 * Dates for the national appeals are approximate: they move each year, and the
 * game only needs them to land in the right month.
 */

export interface AskTemplate {
  id: string;
  cause: string;
  title: string;
  body: string;
  suggested: number[];
}

export interface ScheduledAsk extends AskTemplate {
  /** MM-DD the ask arrives, every year. */
  date: string;
  /** Days it stays open to answer. */
  openDays: number;
}

export const SCHEDULED_ASKS: ScheduledAsk[] = [
  {
    id: "harvest", date: "10-18", openDays: 6, cause: "Harvest collection",
    title: "Harvest collection",
    body: "Church is collecting for the food bank. The basket goes round on Sunday.",
    suggested: [200, 500],
  },
  {
    id: "children-in-need", date: "11-13", openDays: 4, cause: "Children in Need",
    title: "Children in Need",
    body: "It is Children in Need night. School has a non-uniform day and everyone is bringing a pound or two.",
    suggested: [200, 500, 1000],
  },
  {
    id: "christmas-appeal", date: "12-06", openDays: 12, cause: "Christmas appeal",
    title: "Christmas appeal",
    body: "The Christmas appeal for families who will go without. Shoeboxes are going in at church.",
    suggested: [500, 1000],
  },
  {
    id: "comic-relief", date: "03-19", openDays: 4, cause: "Comic Relief",
    title: "Red Nose Day",
    body: "Red Nose Day. Noses are for sale at the school door.",
    suggested: [200, 500],
  },
];

export const UNANNOUNCED_ASKS: AskTemplate[] = [
  {
    id: "friend-5k", cause: "A friend's sponsored 5k",
    title: "A friend's sponsored 5k",
    body: "Someone from Youth Club is running a 5k for the air ambulance and has put the JustGiving link in the group chat.",
    suggested: [200, 500],
  },
  {
    id: "disaster", cause: "Disaster appeal",
    title: "Disaster appeal",
    body: "There is a flood appeal on the news tonight. Everyone at school is talking about it.",
    suggested: [500, 1000],
  },
  {
    id: "retiring-collection", cause: "Church retiring collection",
    title: "Retiring collection",
    body: "The offering at church this week is going to a mission partner. Nobody is checking what you put in.",
    suggested: [100, 300],
  },
  {
    id: "bucket", cause: "Bucket collection",
    title: "Bucket outside Tesco",
    body: "Guide Dogs have a stand with a bucket as you leave the shop.",
    suggested: [100, 200],
  },
  {
    id: "school-silence", cause: "Sponsored silence",
    title: "Sponsored silence",
    body: "The year above are doing a sponsored silence. They have a sheet and it has come to your table.",
    suggested: [100, 300],
  },
  {
    id: "teacher-cake", cause: "Cake sale",
    title: "Cake sale for the school trip fund",
    body: "A teacher is selling cakes at break for a fund so everyone can go on the trip.",
    suggested: [100, 250],
  },
  {
    id: "neighbour", cause: "A neighbour's fundraiser",
    title: "Coffee morning next door",
    body: "A neighbour is holding a coffee morning for a hospice. A card has come through the door.",
    suggested: [300, 500],
  },
  {
    id: "animal", cause: "Animal rescue",
    title: "Animal rescue appeal",
    body: "A local rescue centre is short of money for winter food.",
    suggested: [200, 500],
  },
];

/** Chance of an unannounced ask in a given week, by the season setting. */
export const ASK_CHANCE: Record<"sparse" | "normal" | "generous", number> = {
  sparse: 0.15,
  normal: 0.3,
  generous: 0.5,
};

/** Days an unannounced ask stays open. */
export const UNANNOUNCED_OPEN_DAYS = 2;

/** How far ahead the calendar strip shows scheduled asks. */
export const CALENDAR_LOOKAHEAD_DAYS = 28;
