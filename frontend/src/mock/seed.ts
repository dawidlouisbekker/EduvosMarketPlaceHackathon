/**
 * Mock database rows, shaped like the tables in backend/migrations/0001_init.sql.
 * mock/api.ts reads and mutates these the way the backend would.
 */
import type { NotificationKind, Visibility } from '@/types/models';

const HOUR = 3_600_000;
const now = Date.now();
/** ISO timestamp `hours` ago (negative = in the future). */
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();

export const ME = 'u1';

export const users = [
  { id: 'u1', display_name: 'Jordan Smith', bio: 'BSc IT 2nd year · building things people use', avatar_url: null, is_admin: false },
  { id: 'u2', display_name: 'Thandi Mokoena', bio: 'UX nerd · Figma all day', avatar_url: null, is_admin: false },
  { id: 'u3', display_name: 'Sipho Ndlovu', bio: 'Backend dev, Rust + Postgres', avatar_url: null, is_admin: false },
  { id: 'u4', display_name: 'Aisha Patel', bio: 'Marketing & growth · ex-SRC', avatar_url: null, is_admin: false },
  { id: 'u5', display_name: 'Johan van Wyk', bio: 'Incubation Hub coordinator', avatar_url: null, is_admin: true },
  { id: 'u6', display_name: 'Lerato Dlamini', bio: 'Business student, numbers person', avatar_url: null, is_admin: false },
  { id: 'u7', display_name: 'Kyle Naidoo', bio: 'Mobile dev · React Native', avatar_url: null, is_admin: false },
  { id: 'u8', display_name: 'Zanele Khumalo', bio: 'Data science & AI', avatar_url: null, is_admin: false },
];

export const userSkills: { user_id: string; skill: string }[] = [
  { user_id: 'u1', skill: 'React Native' },
  { user_id: 'u1', skill: 'PostgreSQL' },
  { user_id: 'u1', skill: 'Public speaking' },
  { user_id: 'u2', skill: 'UI/UX Design' },
  { user_id: 'u2', skill: 'Figma' },
  { user_id: 'u3', skill: 'Rust' },
  { user_id: 'u3', skill: 'PostgreSQL' },
  { user_id: 'u4', skill: 'Marketing' },
  { user_id: 'u4', skill: 'Public speaking' },
  { user_id: 'u6', skill: 'Finance' },
  { user_id: 'u7', skill: 'React Native' },
  { user_id: 'u8', skill: 'Python' },
  { user_id: 'u8', skill: 'Machine learning' },
];

/** Every vouch names a role the user held in a project the voucher worked on (or the voucher is an admin). */
export const skillVouches: {
  user_id: string; skill: string; voucher_id: string; project_id: string | null; role_id: string | null; created_at: string;
}[] = [
  { user_id: 'u1', skill: 'React Native', voucher_id: 'u3', project_id: 'pr1', role_id: 'r2', created_at: ago(20) },
  { user_id: 'u1', skill: 'React Native', voucher_id: 'u2', project_id: 'pr1', role_id: 'r2', created_at: ago(44) },
  { user_id: 'u1', skill: 'PostgreSQL', voucher_id: 'u6', project_id: 'pr2', role_id: 'r5', created_at: ago(30) },
  // Role link cleared: the project/role was removed after the admin vouched.
  { user_id: 'u1', skill: 'Public speaking', voucher_id: 'u5', project_id: null, role_id: null, created_at: ago(200) },
  { user_id: 'u2', skill: 'UI/UX Design', voucher_id: 'u1', project_id: 'pr1', role_id: 'r1', created_at: ago(10) },
  { user_id: 'u2', skill: 'UI/UX Design', voucher_id: 'u3', project_id: 'pr1', role_id: 'r1', created_at: ago(26) },
  { user_id: 'u2', skill: 'UI/UX Design', voucher_id: 'u4', project_id: 'pr4', role_id: 'r9', created_at: ago(60) },
  { user_id: 'u2', skill: 'Figma', voucher_id: 'u4', project_id: 'pr4', role_id: 'r9', created_at: ago(58) },
  { user_id: 'u3', skill: 'Rust', voucher_id: 'u1', project_id: 'pr1', role_id: 'r3', created_at: ago(12) },
  { user_id: 'u3', skill: 'PostgreSQL', voucher_id: 'u2', project_id: 'pr1', role_id: 'r3', created_at: ago(15) },
  { user_id: 'u4', skill: 'Marketing', voucher_id: 'u6', project_id: 'pr2', role_id: 'r6', created_at: ago(40) },
  { user_id: 'u6', skill: 'Finance', voucher_id: 'u4', project_id: 'pr5', role_id: 'r11', created_at: ago(50) },
  { user_id: 'u7', skill: 'React Native', voucher_id: 'u3', project_id: 'pr3', role_id: 'r7', created_at: ago(22) },
];

export const prospects: { owner_id: string; prospect_id: string }[] = [
  { owner_id: 'u1', prospect_id: 'u2' },
  { owner_id: 'u1', prospect_id: 'u3' },
  { owner_id: 'u2', prospect_id: 'u1' },
  { owner_id: 'u3', prospect_id: 'u1' },
];

// ---------------------------------------------------------------- problems

export const problems = [
  { id: 'p1', user_id: 'u2', title: 'Cafeteria queues eat half my lunch break', description: 'Between 12:00 and 13:00 the queue at the campus cafeteria is 20+ minutes. By the time I get food I have 10 minutes to eat before class.', created_at: ago(2) },
  { id: 'p2', user_id: 'u4', title: 'No easy way to find study partners for a module', description: 'WhatsApp groups are chaos. I want to find 2–3 people doing the same module who want to study at the same times.', created_at: ago(5) },
  { id: 'p3', user_id: 'u6', title: 'Textbooks are way too expensive', description: 'Some prescribed books cost R1500+. Seniors have them lying around but there is no trusted place to buy second-hand.', created_at: ago(9) },
  { id: 'p4', user_id: 'u3', title: 'Load-shedding kills group project meetings', description: 'Half the team drops off calls when their area goes down. We lose momentum and deadlines slip.', created_at: ago(20) },
  { id: 'p5', user_id: 'u7', title: 'Lift clubs to campus are hard to organise', description: 'Lots of students drive in from the same suburbs alone. Petrol is expensive and parking is full by 8am.', created_at: ago(28) },
  { id: 'p6', user_id: 'u8', title: 'Hard to know which lecturers are available when', description: 'Consultation hours are posted in random places. I walk to an office and nobody is there.', created_at: ago(34) },
  { id: 'p7', user_id: 'u1', title: 'Student businesses have no place to advertise', description: 'Lots of students sell food, do nails, fix laptops… but you only hear about them by word of mouth.', created_at: ago(40) },
  { id: 'p8', user_id: 'u2', title: 'Campus Wi-Fi dead zones', description: 'The library second floor and the back labs have almost no signal. Hard to submit anything there.', created_at: ago(52) },
  { id: 'p9', user_id: 'u6', title: 'Budgeting on a student allowance is hard', description: 'NSFAS / bursary money comes in once and it is gone by week 3. Existing budgeting apps are not made for students.', created_at: ago(60) },
  { id: 'p10', user_id: 'u4', title: 'Events on campus are poorly advertised', description: 'I find out about hackathons and talks the day after they happen.', created_at: ago(75) },
  { id: 'p11', user_id: 'u3', title: 'No mentors for side projects', description: 'I have ideas but nobody to sanity-check the tech or business side before I sink months into it.', created_at: ago(90) },
  { id: 'p12', user_id: 'u7', title: 'Printing credits run out at the worst time', description: 'Always the night before a submission. Topping up requires going to the front desk during office hours.', created_at: ago(110) },
];

export const problemVotes: { problem_id: string; user_id: string }[] = [
  ...['u1', 'u3', 'u4', 'u6', 'u7', 'u8'].map((user_id) => ({ problem_id: 'p1', user_id })),
  ...['u2', 'u3', 'u6', 'u8'].map((user_id) => ({ problem_id: 'p2', user_id })),
  ...['u1', 'u2', 'u4', 'u7', 'u8'].map((user_id) => ({ problem_id: 'p3', user_id })),
  ...['u1', 'u2', 'u7'].map((user_id) => ({ problem_id: 'p4', user_id })),
  ...['u3', 'u6'].map((user_id) => ({ problem_id: 'p5', user_id })),
  ...['u2', 'u4', 'u7'].map((user_id) => ({ problem_id: 'p6', user_id })),
  ...['u2', 'u3', 'u4', 'u6', 'u8'].map((user_id) => ({ problem_id: 'p7', user_id })),
  ...['u1', 'u3', 'u4', 'u7'].map((user_id) => ({ problem_id: 'p8', user_id })),
  ...['u2', 'u4'].map((user_id) => ({ problem_id: 'p9', user_id })),
  ...['u1'].map((user_id) => ({ problem_id: 'p10', user_id })),
  ...['u1', 'u8'].map((user_id) => ({ problem_id: 'p11', user_id })),
];

// ---------------------------------------------------------------- ideas

export const ideas: { id: string; user_id: string; title: string; description: string; visibility: Visibility; project_id: string | null; created_at: string }[] = [
  { id: 'i1', user_id: 'u1', title: 'Pre-order app for the cafeteria', description: 'Order and pay from your phone, pick a 5-minute pickup slot, skip the queue. The cafeteria sees a live list of orders per slot.', visibility: 'public', project_id: 'pr1', created_at: ago(1) },
  { id: 'i2', user_id: 'u2', title: 'Study-buddy matcher', description: 'Pick your modules and free times, get matched with 2–3 people. Chat opens automatically; the group dissolves after exams.', visibility: 'public', project_id: null, created_at: ago(4) },
  { id: 'i3', user_id: 'u6', title: 'Verified second-hand textbook market', description: 'Only Eduvos accounts can list. Seller drops the book at the Hub, buyer collects. No scams, no meeting strangers.', visibility: 'public', project_id: 'pr2', created_at: ago(8) },
  { id: 'i4', user_id: 'u3', title: 'Offline-first project board', description: 'A task board that syncs when you come back online, with SMS fallback for "I am down, will catch up".', visibility: 'private', project_id: null, created_at: ago(18) },
  { id: 'i5', user_id: 'u7', title: 'Campus lift club finder', description: 'Match drivers and passengers by suburb and class times. Split petrol cost automatically.', visibility: 'public', project_id: 'pr3', created_at: ago(26) },
  { id: 'i6', user_id: 'u1', title: 'Student business directory in EduvosMarket', description: 'Every Hub venture and student side-hustle gets a page. Filters for food, services, tech. Reviews from verified students.', visibility: 'public', project_id: 'pr4', created_at: ago(38) },
  { id: 'i7', user_id: 'u8', title: 'Lecturer availability status', description: 'Lecturers tap "in office / away" on their phone; students see live status and a booking slot.', visibility: 'public', project_id: null, created_at: ago(33) },
  { id: 'i8', user_id: 'u4', title: 'One campus events calendar with push alerts', description: 'Clubs and the Hub post events once; students follow categories and get a push the day before.', visibility: 'public', project_id: null, created_at: ago(70) },
  { id: 'i9', user_id: 'u6', title: 'Envelope budgeting for bursary money', description: 'Split your allowance into envelopes on day one (food, transport, data). The app nags you when an envelope runs low.', visibility: 'public', project_id: 'pr5', created_at: ago(58) },
  { id: 'i10', user_id: 'u2', title: 'Wi-Fi heatmap crowd-sourced by students', description: 'The app samples signal strength in the background and builds a heatmap IT can act on.', visibility: 'public', project_id: null, created_at: ago(50) },
  { id: 'i11', user_id: 'u1', title: 'Mentor office hours marketplace', description: 'Alumni and seniors offer 30-minute slots. Students book with a short description of their project.', visibility: 'private', project_id: null, created_at: ago(85) },
  { id: 'i12', user_id: 'u3', title: 'Printing credit top-up via SnapScan', description: 'Scan a QR on the printer, pay, credits appear instantly.', visibility: 'public', project_id: null, created_at: ago(105) },
];

export const ideaVotes: { idea_id: string; user_id: string }[] = [
  ...['u2', 'u3', 'u4', 'u6', 'u7', 'u8', 'u5'].map((user_id) => ({ idea_id: 'i1', user_id })),
  ...['u1', 'u4', 'u8'].map((user_id) => ({ idea_id: 'i2', user_id })),
  ...['u1', 'u2', 'u4', 'u7'].map((user_id) => ({ idea_id: 'i3', user_id })),
  ...['u1'].map((user_id) => ({ idea_id: 'i4', user_id })),
  ...['u3', 'u6'].map((user_id) => ({ idea_id: 'i5', user_id })),
  ...['u2', 'u3', 'u4', 'u5', 'u6'].map((user_id) => ({ idea_id: 'i6', user_id })),
  ...['u2', 'u7'].map((user_id) => ({ idea_id: 'i7', user_id })),
  ...['u1', 'u2', 'u3', 'u6'].map((user_id) => ({ idea_id: 'i8', user_id })),
  ...['u4'].map((user_id) => ({ idea_id: 'i9', user_id })),
  ...['u1', 'u7'].map((user_id) => ({ idea_id: 'i10', user_id })),
];

export const ideaShares: { idea_id: string; owner_id: string; user_id: string }[] = [
  { idea_id: 'i4', owner_id: 'u3', user_id: 'u1' },
  { idea_id: 'i11', owner_id: 'u1', user_id: 'u2' },
];

export const ideaProblemLinks: { problem_id: string; idea_id: string; description: string }[] = [
  { problem_id: 'p1', idea_id: 'i1', description: 'Removes the queue entirely with pickup slots' },
  { problem_id: 'p2', idea_id: 'i2', description: 'Matches by module and free time' },
  { problem_id: 'p3', idea_id: 'i3', description: 'Trusted second-hand market' },
  { problem_id: 'p4', idea_id: 'i4', description: 'Work continues offline and syncs later' },
  { problem_id: 'p5', idea_id: 'i5', description: 'Matches drivers and passengers' },
  { problem_id: 'p7', idea_id: 'i6', description: 'A directory page for every student business' },
  { problem_id: 'p10', idea_id: 'i6', description: 'Businesses can post events too' },
  { problem_id: 'p6', idea_id: 'i7', description: 'Live lecturer status' },
  { problem_id: 'p10', idea_id: 'i8', description: 'One calendar, push alerts' },
  { problem_id: 'p9', idea_id: 'i9', description: 'Envelope budgeting' },
  { problem_id: 'p8', idea_id: 'i10', description: 'Data to show IT where to fix' },
  { problem_id: 'p11', idea_id: 'i11', description: 'Book time with a mentor' },
  { problem_id: 'p12', idea_id: 'i12', description: 'Top up at the printer' },
];

export const commentTypes = [
  { id: 'ct1', label: 'Feedback', color: '#3C87F7' },
  { id: 'ct2', label: 'Question', color: '#8E4EC6' },
  { id: 'ct3', label: 'Concern', color: '#E5484D' },
  { id: 'ct4', label: 'Support', color: '#30A46C' },
];

export const ideaComments: {
  id: string; idea_id: string; parent_id: string | null; user_id: string | null; comment_type: string;
  content: string; depth: number; deleted_at: string | null; created_at: string;
}[] = [
  { id: 'c1', idea_id: 'i1', parent_id: null, user_id: 'u4', comment_type: 'ct4', content: 'I would use this every single day. Take my money.', depth: 0, deleted_at: null, created_at: ago(0.9) },
  { id: 'c2', idea_id: 'i1', parent_id: null, user_id: 'u3', comment_type: 'ct2', content: 'How does the cafeteria get the orders? Do they need a tablet?', depth: 0, deleted_at: null, created_at: ago(0.8) },
  { id: 'c3', idea_id: 'i1', parent_id: 'c2', user_id: 'u1', comment_type: 'ct1', content: 'Yes, a cheap Android tablet with a web view. Orders grouped by pickup slot.', depth: 1, deleted_at: null, created_at: ago(0.7) },
  { id: 'c4', idea_id: 'i1', parent_id: 'c3', user_id: 'u3', comment_type: 'ct4', content: 'Nice, that is simple enough to pilot next month.', depth: 2, deleted_at: null, created_at: ago(0.6) },
  { id: 'c5', idea_id: 'i1', parent_id: null, user_id: 'u6', comment_type: 'ct3', content: 'Payments could be tricky. Card fees on R35 meals add up.', depth: 0, deleted_at: null, created_at: ago(0.5) },
  { id: 'c6', idea_id: 'i1', parent_id: 'c5', user_id: null, comment_type: 'ct1', content: '[deleted]', depth: 1, deleted_at: ago(0.3), created_at: ago(0.4) },
  { id: 'c7', idea_id: 'i1', parent_id: 'c6', user_id: 'u1', comment_type: 'ct1', content: 'We could start with a prepaid wallet you top up once a week.', depth: 2, deleted_at: null, created_at: ago(0.2) },
  { id: 'c8', idea_id: 'i2', parent_id: null, user_id: 'u8', comment_type: 'ct1', content: 'Add a "quiet study" vs "discussion" preference!', depth: 0, deleted_at: null, created_at: ago(3) },
  { id: 'c9', idea_id: 'i3', parent_id: null, user_id: 'u2', comment_type: 'ct2', content: 'Would the Hub be OK storing books temporarily?', depth: 0, deleted_at: null, created_at: ago(7) },
  { id: 'c10', idea_id: 'i3', parent_id: 'c9', user_id: 'u5', comment_type: 'ct4', content: 'We have a locker room we can use. Come see me.', depth: 1, deleted_at: null, created_at: ago(6) },
  { id: 'c11', idea_id: 'i6', parent_id: null, user_id: 'u5', comment_type: 'ct4', content: 'This is exactly what the Hub needs.', depth: 0, deleted_at: null, created_at: ago(30) },
];

export const ideaCommentVotes: { comment_id: string; user_id: string; value: 1 | -1 }[] = [
  { comment_id: 'c1', user_id: 'u2', value: 1 },
  { comment_id: 'c1', user_id: 'u7', value: 1 },
  { comment_id: 'c3', user_id: 'u2', value: 1 },
  { comment_id: 'c3', user_id: 'u4', value: 1 },
  { comment_id: 'c3', user_id: 'u8', value: 1 },
  { comment_id: 'c5', user_id: 'u1', value: 1 },
  { comment_id: 'c5', user_id: 'u7', value: -1 },
  { comment_id: 'c10', user_id: 'u6', value: 1 },
];

// ---------------------------------------------------------------- projects

export const projects: {
  id: string; owner_id: string; name: string; description: string; visibility: Visibility;
  deadline: string | null; show_media: boolean; created_at: string;
}[] = [
  { id: 'pr1', owner_id: 'u1', name: 'QueueLess', description: 'Cafeteria pre-ordering with pickup slots. Pilot with the main campus cafeteria this term.', visibility: 'public', deadline: ago(-24 * 30), show_media: true, created_at: ago(0.5) },
  { id: 'pr2', owner_id: 'u6', name: 'BookSwap', description: 'Verified second-hand textbook marketplace with Hub drop-off lockers.', visibility: 'public', deadline: ago(-24 * 60), show_media: false, created_at: ago(7) },
  { id: 'pr3', owner_id: 'u7', name: 'LiftClub', description: 'Match students driving in from the same suburbs and split petrol costs.', visibility: 'public', deadline: null, show_media: false, created_at: ago(25) },
  { id: 'pr4', owner_id: 'u1', name: 'EduvosMarket Directory', description: 'The directory of Hub ventures and student businesses, inside this app.', visibility: 'public', deadline: ago(-24 * 14), show_media: true, created_at: ago(36) },
  { id: 'pr5', owner_id: 'u6', name: 'Envelopes', description: 'Budgeting for bursary money. Private beta with the finance club.', visibility: 'private', deadline: ago(-24 * 45), show_media: false, created_at: ago(55) },
  { id: 'pr6', owner_id: 'u3', name: 'SyncBoard', description: 'Offline-first task board for teams with unreliable power and internet.', visibility: 'public', deadline: ago(-24 * 90), show_media: false, created_at: ago(15) },
];

export const projectMedia = [
  { id: 'm1', project_id: 'pr1', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  { id: 'm2', project_id: 'pr4', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
];

export const projectCategories = [
  { id: 'cat1', project_id: 'pr1', name: 'Design' },
  { id: 'cat2', project_id: 'pr1', name: 'Mobile' },
  { id: 'cat3', project_id: 'pr1', name: 'Backend' },
  { id: 'cat4', project_id: 'pr1', name: 'Operations' },
  { id: 'cat5', project_id: 'pr2', name: 'Web' },
  { id: 'cat6', project_id: 'pr2', name: 'Logistics' },
  { id: 'cat7', project_id: 'pr3', name: 'Mobile' },
  { id: 'cat8', project_id: 'pr4', name: 'Frontend' },
  { id: 'cat9', project_id: 'pr4', name: 'Content' },
  { id: 'cat10', project_id: 'pr5', name: 'Product' },
  { id: 'cat11', project_id: 'pr6', name: 'Backend' },
  { id: 'cat12', project_id: 'pr6', name: 'Frontend' },
];

export const projectRoles = [
  { id: 'r1', project_id: 'pr1', name: 'Designer' },
  { id: 'r2', project_id: 'pr1', name: 'Mobile dev' },
  { id: 'r3', project_id: 'pr1', name: 'Backend dev' },
  { id: 'r4', project_id: 'pr1', name: 'Cafeteria liaison' },
  { id: 'r5', project_id: 'pr2', name: 'Web dev' },
  { id: 'r6', project_id: 'pr2', name: 'Logistics lead' },
  { id: 'r7', project_id: 'pr3', name: 'Mobile dev' },
  { id: 'r8', project_id: 'pr3', name: 'Marketing' },
  { id: 'r9', project_id: 'pr4', name: 'Frontend dev' },
  { id: 'r10', project_id: 'pr4', name: 'Content writer' },
  { id: 'r11', project_id: 'pr5', name: 'Product lead' },
  { id: 'r12', project_id: 'pr6', name: 'Rust dev' },
  { id: 'r13', project_id: 'pr6', name: 'Frontend dev' },
];

export const projectRoleCategories = [
  { role_id: 'r1', category_id: 'cat1' },
  { role_id: 'r2', category_id: 'cat2' },
  { role_id: 'r3', category_id: 'cat3' },
  { role_id: 'r4', category_id: 'cat4' },
  { role_id: 'r5', category_id: 'cat5' },
  { role_id: 'r6', category_id: 'cat6' },
  { role_id: 'r7', category_id: 'cat7' },
  { role_id: 'r9', category_id: 'cat8' },
  { role_id: 'r10', category_id: 'cat9' },
  { role_id: 'r11', category_id: 'cat10' },
  { role_id: 'r12', category_id: 'cat11' },
  { role_id: 'r13', category_id: 'cat12' },
];

// Owners are participants too (the backend adds them on project creation), so they can hold roles.
export const projectParticipants = [
  { project_id: 'pr1', user_id: 'u1' },
  { project_id: 'pr2', user_id: 'u6' },
  { project_id: 'pr3', user_id: 'u7' },
  { project_id: 'pr4', user_id: 'u1' },
  { project_id: 'pr5', user_id: 'u6' },
  { project_id: 'pr6', user_id: 'u3' },
  { project_id: 'pr1', user_id: 'u2' },
  { project_id: 'pr1', user_id: 'u3' },
  { project_id: 'pr2', user_id: 'u1' },
  { project_id: 'pr2', user_id: 'u4' },
  { project_id: 'pr3', user_id: 'u3' },
  { project_id: 'pr4', user_id: 'u2' },
  { project_id: 'pr4', user_id: 'u4' },
  { project_id: 'pr5', user_id: 'u4' },
];

export const projectParticipantRoles = [
  { project_id: 'pr1', user_id: 'u1', role_id: 'r2' },
  { project_id: 'pr2', user_id: 'u6', role_id: 'r6' },
  { project_id: 'pr3', user_id: 'u7', role_id: 'r7' },
  { project_id: 'pr4', user_id: 'u1', role_id: 'r9' },
  { project_id: 'pr5', user_id: 'u6', role_id: 'r11' },
  { project_id: 'pr6', user_id: 'u3', role_id: 'r12' },
  { project_id: 'pr1', user_id: 'u2', role_id: 'r1' },
  { project_id: 'pr1', user_id: 'u3', role_id: 'r3' },
  { project_id: 'pr2', user_id: 'u1', role_id: 'r5' },
  { project_id: 'pr2', user_id: 'u4', role_id: 'r6' },
  { project_id: 'pr3', user_id: 'u3', role_id: 'r7' },
  { project_id: 'pr4', user_id: 'u2', role_id: 'r9' },
  { project_id: 'pr4', user_id: 'u4', role_id: 'r10' },
  { project_id: 'pr5', user_id: 'u4', role_id: 'r11' },
];

export const projectRequests = [
  { project_id: 'pr1', user_id: 'u7' },
  { project_id: 'pr1', user_id: 'u8' },
  { project_id: 'pr6', user_id: 'u1' },
];

export const projectInvites = [{ project_id: 'pr3', user_id: 'u1' }];

export const projectTasks = [
  { id: 't1', project_id: 'pr1', position: 0, description: 'Interview cafeteria staff about peak hours', deadline: ago(24 * 3), completed: true },
  { id: 't2', project_id: 'pr1', position: 1, description: 'Design order + pickup-slot screens', deadline: ago(-24 * 4), completed: true },
  { id: 't3', project_id: 'pr1', position: 2, description: 'Orders API with slot capacity', deadline: ago(-24 * 10), completed: false },
  { id: 't4', project_id: 'pr1', position: 3, description: 'Mobile ordering flow', deadline: ago(-24 * 18), completed: false },
  { id: 't5', project_id: 'pr1', position: 4, description: 'Kitchen tablet view', deadline: ago(-24 * 24), completed: false },
  { id: 't6', project_id: 'pr1', position: 5, description: 'One-week pilot at main campus', deadline: ago(-24 * 30), completed: false },
  { id: 't7', project_id: 'pr2', position: 0, description: 'Listing + search pages', deadline: ago(-24 * 20), completed: false },
  { id: 't8', project_id: 'pr2', position: 1, description: 'Agree locker process with the Hub', deadline: ago(-24 * 25), completed: false },
  { id: 't9', project_id: 'pr4', position: 0, description: 'Business page layout', deadline: ago(24), completed: true },
  { id: 't10', project_id: 'pr4', position: 1, description: 'Write profiles for 10 Hub ventures', deadline: ago(-24 * 7), completed: false },
  { id: 't11', project_id: 'pr6', position: 0, description: 'CRDT sync prototype', deadline: ago(-24 * 30), completed: false },
];

export const projectTaskCategories = [
  { task_id: 't1', category_id: 'cat4' },
  { task_id: 't2', category_id: 'cat1' },
  { task_id: 't3', category_id: 'cat3' },
  { task_id: 't4', category_id: 'cat2' },
  { task_id: 't4', category_id: 'cat1' },
  { task_id: 't5', category_id: 'cat2' },
  { task_id: 't6', category_id: 'cat4' },
  { task_id: 't7', category_id: 'cat5' },
  { task_id: 't8', category_id: 'cat6' },
  { task_id: 't9', category_id: 'cat8' },
  { task_id: 't10', category_id: 'cat9' },
  { task_id: 't11', category_id: 'cat11' },
];

export const entrepreneurialVouches = [
  { user_id: 'u1', project_id: 'pr4', description: 'Pitched the directory to the Hub board and signed up 12 ventures.', voucher_id: 'u5' },
  { user_id: 'u6', project_id: 'pr2', description: 'Negotiated locker space and ran the first book drive.', voucher_id: 'u5' },
];

// ---------------------------------------------------------------- notifications

export const notifications: {
  id: string; user_id: string; actor_id: string | null; kind: NotificationKind;
  problem_id: string | null; idea_id: string | null; project_id: string | null; comment_id: string | null;
  read_at: string | null; created_at: string;
}[] = [
  { id: 'n1', user_id: 'u1', actor_id: 'u8', kind: 'join_request', problem_id: null, idea_id: null, project_id: 'pr1', comment_id: null, read_at: null, created_at: ago(0.3) },
  { id: 'n2', user_id: 'u1', actor_id: 'u3', kind: 'comment_reply', problem_id: null, idea_id: 'i1', project_id: null, comment_id: 'c4', read_at: null, created_at: ago(0.6) },
  { id: 'n3', user_id: 'u1', actor_id: 'u4', kind: 'idea_comment', problem_id: null, idea_id: 'i1', project_id: null, comment_id: 'c1', read_at: null, created_at: ago(0.9) },
  { id: 'n4', user_id: 'u1', actor_id: 'u7', kind: 'project_invite', problem_id: null, idea_id: null, project_id: 'pr3', comment_id: null, read_at: null, created_at: ago(3) },
  { id: 'n5', user_id: 'u1', actor_id: 'u7', kind: 'join_request', problem_id: null, idea_id: null, project_id: 'pr1', comment_id: null, read_at: ago(4), created_at: ago(5) },
  { id: 'n6', user_id: 'u1', actor_id: 'u3', kind: 'idea_shared', problem_id: null, idea_id: 'i4', project_id: null, comment_id: null, read_at: ago(10), created_at: ago(18) },
  { id: 'n7', user_id: 'u1', actor_id: 'u7', kind: 'skill_vouch', problem_id: null, idea_id: null, project_id: null, comment_id: null, read_at: ago(20), created_at: ago(22) },
  { id: 'n8', user_id: 'u1', actor_id: 'u5', kind: 'entrepreneur_vouch', problem_id: null, idea_id: null, project_id: 'pr4', comment_id: null, read_at: ago(30), created_at: ago(32) },
  { id: 'n9', user_id: 'u1', actor_id: 'u6', kind: 'request_accepted', problem_id: null, idea_id: null, project_id: 'pr2', comment_id: null, read_at: ago(40), created_at: ago(48) },
];
