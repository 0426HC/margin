// Static data for the Reading Room workspace mockup.
// The Original text is Federalist No. 10 (Madison, 1787), public domain, taken verbatim
// from Project Gutenberg #1404. Page numbers are illustrative: the real app reads them from the PDF.

export type Status = "new" | "shaky" | "solid";
export type Mode = "original" | "explained";

export type OriginalBlock = {
  kind: "title" | "subtitle" | "dateline" | "byline" | "salutation" | "p";
  text: string;
  page: number;
};

export type ExplainedPara = { text: string; pages: number[] };

export type SectionMeta = {
  id: string;
  title: string;
  status: Status;
  due?: boolean;
  /** One line for the overview's labels. */
  focus: string;
  why: string;
};
export type UnitMeta = {
  id: string;
  /** Short name for the rail and kicker, such as "Week 2". */
  label: string;
  name: string;
  /** The list's heading. */
  title: string;
  why: string;
  sections: SectionMeta[];
};

export const course = { title: "The Federalist Papers", code: "POL 210" };

export const FILE = "federalist-papers.pdf";
export const ACTIVE_ID = "no10-1";

const WHY_10_1 =
  "This is the problem Madison sets out to solve, so the rest of No. 10 is an answer to it. It builds on No. 9, where Hamilton argued that the Union protects the states from faction and insurrection, and it hands you the key term, faction, that the next part uses when it asks how to control its effects.";

export const units: UnitMeta[] = [
  {
    id: "overview",
    label: "Start here",
    name: "Course overview",
    title: "Course overview",
    why: "The syllabus sets the through-line: how the authors argue that a large republic can survive its own divisions. Every reading after this is one step in that argument, so start here to see what each week is building towards.",
    sections: [
      { id: "syllabus", title: "Syllabus", status: "solid", focus: "What the course argues, week by week.", why: "The course's through-line: how the authors argue that a large republic can survive its own divisions. Every reading is one step in that argument." },
    ],
  },
  {
    id: "w1",
    label: "Week 1",
    name: "Why a union",
    title: "Week 1: Why a union",
    why: "Before anyone argues about structure, the authors have to show that union is worth having at all. These essays set the stakes and answer the idea that the states could simply go their own way. Week 2 then turns to the danger inside the states themselves.",
    sections: [
      { id: "no1", title: "Federalist No. 1", status: "solid", focus: "Can people choose government by reflection and choice?", why: "Hamilton sets the stakes: whether people can establish good government from reflection and choice, rather than accident and force. Everything after this is the case for ratifying." },
      { id: "no2", title: "Federalist No. 2", status: "solid", focus: "Jay: Americans are already one people.", why: "Jay argues that Americans are already one people, joined by geography, language and a shared war. That makes union look natural before anyone argues about its structure." },
      { id: "no6", title: "Federalist No. 6", status: "shaky", due: true, focus: "Separate states would end up fighting each other.", why: "Hamilton argues that separate states would end up fighting each other. It answers anyone who thinks the states could simply go their own way, and it leads into the question of internal conflict." },
    ],
  },
  {
    id: "w2",
    label: "Week 2",
    name: "The Union and faction",
    title: "Week 2: The Union and faction",
    why: "This is the centre of the course. Week 1 argued that the states need each other; here Hamilton and Madison face the objection that a large republic will be torn apart by faction. Madison\u2019s answer, that size is the cure, is the idea the later weeks keep building on.",
    sections: [
      { id: "no9", title: "Federalist No. 9", status: "solid", focus: "Failed republics, and a confederate republic as the remedy.", why: "Hamilton uses the failed republics of Greece and Italy to show what faction does, and offers a confederate republic as the remedy. Madison picks up the same problem in No. 10." },
      { id: "no10-1", title: "Federalist No. 10, part 1 of 3", status: "shaky", due: true, focus: "What faction is, and why its causes can\u2019t be removed.", why: WHY_10_1 },
      { id: "no10-2", title: "Federalist No. 10, part 2 of 3", status: "new", focus: "A majority faction has no cure in a pure democracy.", why: "Madison turns from causes to effects. A minority faction can be outvoted, but a majority faction cannot, and a pure democracy has no cure for it." },
      { id: "no10-3", title: "Federalist No. 10, part 3 of 3", status: "new", focus: "Representation and size make lasting majorities hard.", why: "The payoff of the essay: representation and a large territory make it hard for any one faction to form a lasting majority. This is the argument the course keeps returning to." },
    ],
  },
  {
    id: "w3",
    label: "Week 3",
    name: "A republic\u2019s structure",
    title: "Week 3: A republic\u2019s structure",
    why: "The argument moves from why to how. Having defended a large republic, Madison has to show that its structure can keep power divided and ambition in check. These essays turn the cure for faction into working institutions.",
    sections: [
      { id: "no39", title: "Federalist No. 39", status: "new", focus: "What makes a government republican.", why: "Madison defines what makes a government republican, then shows the Constitution is partly national and partly federal. It moves the course from why to how." },
      { id: "no47", title: "Federalist No. 47", status: "new", focus: "Why gathering all power in one place is tyranny.", why: "Madison takes on the charge that the Constitution mixes the branches. He calls gathering all power in the same hands the very definition of tyranny." },
      { id: "no51", title: "Federalist No. 51", status: "new", focus: "Ambition must be made to counteract ambition.", why: "Ambition must be made to counteract ambition. This is the structural answer to the problem of faction you met in No. 10." },
    ],
  },
  {
    id: "w4",
    label: "Week 4",
    name: "The branches",
    title: "Week 4: The branches",
    why: "The course ends by testing the structure branch by branch. The House, the presidency and the courts each get their own defence, and each is a different answer to the same question: how do you give government power without losing control of it?",
    sections: [
      { id: "no57", title: "Federalist No. 57", status: "new", focus: "Frequent elections keep the House tied to the people.", why: "Madison answers the worry that the House will become an elite. Frequent elections keep representatives dependent on the people." },
      { id: "no70", title: "Federalist No. 70", status: "new", focus: "The case for energy in a single executive.", why: "Hamilton argues for energy in the executive, and for one president rather than a council. It is a different kind of safeguard from the checks in No. 51." },
      { id: "no78", title: "Federalist No. 78", status: "new", focus: "The least dangerous branch, judging laws.", why: "Hamilton calls the judiciary the least dangerous branch and makes the case for courts judging laws against the Constitution. It closes the course\u2019s tour of the branches." },
    ],
  },
];

export const section = {
  id: ACTIVE_ID,
  title: "Federalist No. 10, part 1 of 3",
  subtitle: "The Same Subject Continued (The Union as a Safeguard Against Domestic Faction and Insurrection)",
  source: FILE,
  pages: [38, 40] as [number, number],
  minutes: 5,
  why: WHY_10_1,
};

export const original: OriginalBlock[] = [
  {
    "kind": "title",
    "text": "FEDERALIST No. 10",
    "page": 38
  },
  {
    "kind": "subtitle",
    "text": "The Same Subject Continued (The Union as a Safeguard Against Domestic Faction and Insurrection)",
    "page": 38
  },
  {
    "kind": "dateline",
    "text": "From the Daily Advertiser. Thursday, November 22, 1787.",
    "page": 38
  },
  {
    "kind": "byline",
    "text": "MADISON",
    "page": 38
  },
  {
    "kind": "salutation",
    "text": "To the People of the State of New York:",
    "page": 38
  },
  {
    "kind": "p",
    "text": "AMONG the numerous advantages promised by a well constructed Union, none deserves to be more accurately developed than its tendency to break and control the violence of faction. The friend of popular governments never finds himself so much alarmed for their character and fate, as when he contemplates their propensity to this dangerous vice. He will not fail, therefore, to set a due value on any plan which, without violating the principles to which he is attached, provides a proper cure for it. The instability, injustice, and confusion introduced into the public councils, have, in truth, been the mortal diseases under which popular governments have everywhere perished; as they continue to be the favorite and fruitful topics from which the adversaries to liberty derive their most specious declamations. The valuable improvements made by the American constitutions on the popular models, both ancient and modern, cannot certainly be too much admired; but it would be an unwarrantable partiality, to contend that they have as effectually obviated the danger on this side, as was wished and expected. Complaints are everywhere heard from our most considerate and virtuous citizens, equally the friends of public and private faith, and of public and personal liberty, that our governments are too unstable, that the public good is disregarded in the conflicts of rival parties, and that measures are too often decided, not according to the rules of justice and the rights of the minor party, but by the superior force of an interested and overbearing majority. However anxiously we may wish that these complaints had no foundation, the evidence, of known facts will not permit us to deny that they are in some degree true. It will be found, indeed, on a candid review of our situation, that some of the distresses under which we labor have been erroneously charged on the operation of our governments; but it will be found, at the same time, that other causes will not alone account for many of our heaviest misfortunes; and, particularly, for that prevailing and increasing distrust of public engagements, and alarm for private rights, which are echoed from one end of the continent to the other. These must be chiefly, if not wholly, effects of the unsteadiness and injustice with which a factious spirit has tainted our public administrations.",
    "page": 38
  },
  {
    "kind": "p",
    "text": "By a faction, I understand a number of citizens, whether amounting to a majority or a minority of the whole, who are united and actuated by some common impulse of passion, or of interest, adversed to the rights of other citizens, or to the permanent and aggregate interests of the community.",
    "page": 39
  },
  {
    "kind": "p",
    "text": "There are two methods of curing the mischiefs of faction: the one, by removing its causes; the other, by controlling its effects.",
    "page": 39
  },
  {
    "kind": "p",
    "text": "There are again two methods of removing the causes of faction: the one, by destroying the liberty which is essential to its existence; the other, by giving to every citizen the same opinions, the same passions, and the same interests.",
    "page": 39
  },
  {
    "kind": "p",
    "text": "It could never be more truly said than of the first remedy, that it was worse than the disease. Liberty is to faction what air is to fire, an aliment without which it instantly expires. But it could not be less folly to abolish liberty, which is essential to political life, because it nourishes faction, than it would be to wish the annihilation of air, which is essential to animal life, because it imparts to fire its destructive agency.",
    "page": 39
  },
  {
    "kind": "p",
    "text": "The second expedient is as impracticable as the first would be unwise. As long as the reason of man continues fallible, and he is at liberty to exercise it, different opinions will be formed. As long as the connection subsists between his reason and his self-love, his opinions and his passions will have a reciprocal influence on each other; and the former will be objects to which the latter will attach themselves. The diversity in the faculties of men, from which the rights of property originate, is not less an insuperable obstacle to a uniformity of interests. The protection of these faculties is the first object of government. From the protection of different and unequal faculties of acquiring property, the possession of different degrees and kinds of property immediately results; and from the influence of these on the sentiments and views of the respective proprietors, ensues a division of the society into different interests and parties.",
    "page": 40
  },
  {
    "kind": "p",
    "text": "The latent causes of faction are thus sown in the nature of man; and we see them everywhere brought into different degrees of activity, according to the different circumstances of civil society. A zeal for different opinions concerning religion, concerning government, and many other points, as well of speculation as of practice; an attachment to different leaders ambitiously contending for pre-eminence and power; or to persons of other descriptions whose fortunes have been interesting to the human passions, have, in turn, divided mankind into parties, inflamed them with mutual animosity, and rendered them much more disposed to vex and oppress each other than to co-operate for their common good. So strong is this propensity of mankind to fall into mutual animosities, that where no substantial occasion presents itself, the most frivolous and fanciful distinctions have been sufficient to kindle their unfriendly passions and excite their most violent conflicts. But the most common and durable source of factions has been the various and unequal distribution of property. Those who hold and those who are without property have ever formed distinct interests in society. Those who are creditors, and those who are debtors, fall under a like discrimination. A landed interest, a manufacturing interest, a mercantile interest, a moneyed interest, with many lesser interests, grow up of necessity in civilized nations, and divide them into different classes, actuated by different sentiments and views. The regulation of these various and interfering interests forms the principal task of modern legislation, and involves the spirit of party and faction in the necessary and ordinary operations of the government.",
    "page": 40
  }
];

export const explained: ExplainedPara[] = [
  {
    text: "Madison opens by saying the best thing about a well-built Union is that it can break and control the violence of faction. Popular governments, he says, have always died of instability, injustice and confusion. People already complain that American state governments are too unstable and that majorities override the rights of the minority, and he blames a \u201cfactious spirit\u201d for much of the distrust and alarm in the country.",
    pages: [38],
  },
  {
    text: "Here is the definition everything else depends on. A faction is a group of citizens, a majority or a minority, who are united by a common passion or interest that works against other citizens\u2019 rights or against the long-term interests of the community. Size does not matter. What makes a faction is pushing your own interest against everyone else.",
    pages: [39],
  },
  {
    text: "He then splits the problem in two. You can cure faction by removing its causes, or by controlling its effects. Removing the causes could also be done two ways: destroy the liberty that faction lives on, or give every citizen the same opinions, passions and interests.",
    pages: [39],
  },
  {
    text: "The first remedy he calls worse than the disease. His image is that liberty is to faction what air is to fire. Abolishing liberty to stop faction would be as foolish as abolishing air to stop fire.",
    pages: [39],
  },
  {
    text: "The second remedy is impossible. People reason differently, and their opinions get tangled up with self-love and passion. People also have different abilities, and protecting those abilities leads to unequal property, which divides society into different interests and parties.",
    pages: [40],
  },
  {
    text: "So the causes of faction are \u201csown in the nature of man\u201d and cannot be removed. Religion, politics and rival leaders can divide people even over trivial things, but the most common and lasting cause is unequal property: those who have it and those who do not, creditors and debtors, and the landed, manufacturing, mercantile and moneyed interests. Regulating these competing interests is, he says, the main task of modern legislation, which is why faction ends up inside ordinary government.",
    pages: [40],
  },
  {
    text: "The conclusion for now: if the causes cannot be removed, only the effects can be controlled. That is the question the next part takes up.",
    pages: [39],
  },
];

export type ChatItem =
  | { id: string; kind: "action"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "tutor"; text: string; label?: string }
  | { id: string; kind: "saved"; text: string };

export const seedChat: ChatItem[] = [
  { id: "c1", kind: "action", text: "Explain differently: simpler" },
  {
    id: "c2",
    kind: "tutor",
    text: "Think of a faction as a team that only cares about winning for itself, even when that hurts everyone else. Madison says that kind of team can be big or small. The trouble is not its size, it is that it puts its own goals ahead of other people\u2019s rights. [federalist-papers.pdf, p. 39]",
  },
  { id: "c3", kind: "user", text: "Why does he say liberty is to faction what air is to fire?" },
  {
    id: "c4",
    kind: "tutor",
    text: "Because faction needs liberty to exist, the way fire needs air. You could stop a fire by taking away the air, but then nothing could live. Madison says abolishing liberty to stop faction would be the same kind of mistake. [federalist-papers.pdf, p. 39]",
  },
  { id: "c5", kind: "user", text: "note to self: compare this with how Hamilton treats faction in No. 9" },
  { id: "c6", kind: "saved", text: "Saved to Notes." },
  { id: "c7", kind: "user", text: "(Is a faction always a majority?)" },
  { id: "c8", kind: "saved", text: "Question saved to Notes. The answer is added below it." },
  {
    id: "c9",
    kind: "tutor",
    label: "Answer to your question",
    text: "No. Madison says a faction can be \u201ca number of citizens, whether amounting to a majority or a minority of the whole\u201d. What matters is that they act on a shared impulse against the rights of others or the interests of the community. [federalist-papers.pdf, p. 39]",
  },
];

export const actionReplies: Record<string, { user: string; reply: string }> = {
  simpler: {
    user: "Explain differently: simpler",
    reply:
      "Madison says the real danger to a free government is groups that push their own interest over everyone else\u2019s. You cannot get rid of them without getting rid of freedom, so the job is to limit the damage they do. [federalist-papers.pdf, p. 39]",
  },
  example: {
    user: "Explain differently: with an example",
    reply:
      "Say a town votes to cancel a bridge loan because most voters have no use for the bridge, though every farmer across the river depends on it. Madison would call the majority a faction: united by a shared interest that runs against other citizens\u2019 rights. [federalist-papers.pdf, p. 39]",
  },
  analogy: {
    user: "Explain differently: as an analogy",
    reply:
      "It is Madison\u2019s own analogy, pushed a step further. Liberty is the air and faction is the fire. You can keep a fire from spreading, but you cannot ban air without suffocating everyone. [federalist-papers.pdf, p. 39]",
  },
  quiz: {
    user: "Quiz me",
    reply:
      "Question 1. Madison says there are two methods of curing the mischiefs of faction. What are they?",
  },
  teach: {
    user: "Teach it back",
    reply:
      "Go ahead and explain this section in your own words, then send it. I will tell you what you got right, what is missing and anything that is off, with pages.",
  },
  connect: {
    user: "Connect it",
    reply:
      "No. 9 argues that the Union protects the states from faction and insurrection between them. Here Madison turns to faction inside a single state, which is where the large-republic argument in the next part starts. [federalist-papers.pdf, p. 38]",
  },
};
