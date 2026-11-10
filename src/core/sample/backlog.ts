/**
 * The sample team's backlog, written by hand as rows: one initiative, five
 * epics, and about a hundred and thirty items across six sprints and a
 * backlog, for a web shop's team. A row says what the work is and where it
 * sits; ./jira.ts decides when each thing happened. The titles are the kind a
 * team writes at nine in the morning and nobody reads again until the audit.
 *
 * Row order is key order: the initiative is SHOP-1, the epics SHOP-2 to
 * SHOP-6, and every other row takes the next number in the order it is
 * written. The sprint a row belongs to is the block it is in.
 */

export type RowType = 'Story' | 'Task' | 'Bug' | 'Incident' | 'Sub-task' | 'Epic' | 'Initiative';
export type RowState = 'todo' | 'prog' | 'review' | 'done';

export interface Row {
  title: string;
  type: RowType;
  /** A name other rows and pull requests use to point at this one. */
  ref?: string;
  /** The epic it sits under (Epic Link), by ref; for an epic, the initiative it sits under. */
  epic?: string;
  /** A sub-task's parent, by ref. */
  parent?: string;
  /** Components, comma separated. */
  c?: string;
  /** Labels, comma separated. */
  l?: string;
  /** Story points: a number, null for none, left out to draw one by type. */
  p?: number | null;
  /** Assignee by person key, or 'none'; left out to draw one from the component's team. */
  w?: string;
  /** Fix version. */
  fv?: '2.3' | '2.4' | '2.5';
  /** Affected version. */
  av?: '2.3';
  /** The fix version it was first planned for, when it slipped to `fv`. */
  slipped?: '2.3';
  /** Still in the next sprint when this one closed. */
  carry?: boolean;
  /** Added to its sprint after the sprint started. */
  late?: boolean;
  /** Given its fix version after it was created, and after the release had started. */
  added?: boolean;
  /** Where it stands now, for the current sprint and the backlog; every other row is done. */
  st?: RowState;
  /** Working day (0 is today) it moved to In Progress, and to Done, when the draw would not do. */
  start?: number;
  end?: number;
  /** Moved out of Done once and finished again. */
  reopen?: boolean;
  /** The Jira user who opened it, when not drawn. */
  by?: 'bot';
  /** Refs of the rows this one blocks. */
  blocks?: string[];
  /** A description in Jira's wiki markup. */
  d?: string;
  /** A due date, in calendar days from today. */
  due?: number;
}

export interface Block {
  /** The sprint every row in it first belongs to; 0 for the backlog and the structure above it. */
  sprint: number;
  rows: Row[];
}

const row = (type: RowType) => (title: string, o: Omit<Row, 'title' | 'type'> = {}): Row => ({ title, type, ...o });
const S = row('Story');
const T = row('Task');
const B = row('Bug');
const I = row('Incident');
const U = (title: string, parent: string, o: Omit<Row, 'title' | 'type' | 'parent'> = {}): Row => ({ title, type: 'Sub-task', parent, p: null, ...o });

const CVE = (id: string, what: string) => `A dependency scan flagged ${id} in ${what}. The fixed release is out; this ticket is to take it and run the regression suite.\n\n* Upgrade to the patched release\n* Run the checkout and catalog suites\n* Note the version in the release notes`;
const INCIDENT = (what: string) => `h2. What happened\n${what}\n\nh2. Follow-up\n* Write the timeline\n* Decide what would have caught it earlier`;

export const BLOCKS: Block[] = [
  {
    sprint: 0,
    rows: [
      { title: 'Shopfront 2.x: a faster, friendlier storefront', type: 'Initiative', ref: 'I1', l: 'feature', d: 'The 2.x line of the storefront: checkout, discovery and accounts, one release at a time.' },
      { title: 'Checkout redesign', type: 'Epic', ref: 'E1', epic: 'I1', c: 'Checkout', l: 'feature' },
      { title: 'Product discovery and search', type: 'Epic', ref: 'E2', epic: 'I1', c: 'Catalog,Search', l: 'feature' },
      { title: 'Accounts and loyalty', type: 'Epic', ref: 'E3', c: 'Accounts', l: 'feature' },
      { title: 'Platform upkeep', type: 'Epic', ref: 'E4', c: 'Platform', l: 'ktlo', d: 'The work that keeps the storefront standing: upgrades, patches, capacity and clean-up.' },
      { title: 'Order tracking and returns', type: 'Epic', ref: 'E5', c: 'Accounts,Checkout' },
    ],
  },
  {
    sprint: 21,
    rows: [
      S('Add a saved-address picker to the checkout form', { ref: 'saved-address', epic: 'E1', c: 'Checkout', p: 5, fv: '2.3' }),
      S('Show delivery estimates on the cart page', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.3' }),
      S('Pay with a saved card in one tap', { ref: 'one-tap', epic: 'E1', c: 'Checkout', p: 8, fv: '2.3', carry: true }),
      U('Design the saved-card list', 'one-tap'),
      U('Write the saved-card migration', 'one-tap'),
      B('Cart total ignores the discount code on mobile', { epic: 'E1', c: 'Checkout', p: 2, fv: '2.3', l: 'mobile' }),
      S('Faceted filters on the category page', { epic: 'E2', c: 'Catalog', p: 5, fv: '2.3' }),
      S('Rank in-stock products first in search results', { epic: 'E2', c: 'Search', p: 3, fv: '2.3' }),
      T('Bump react-dom to the latest 18.x patch', { c: 'Platform', p: 1, by: 'bot', l: 'dependencies' }),
      S('Email a receipt when an order is placed', { epic: 'E5', c: 'Checkout,Accounts', p: 3, fv: '2.3' }),
      S('Sign in with a one-time email code', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.3' }),
      T('Move the image resizer to the new job queue', { epic: 'E4', c: 'Platform', p: 5 }),
      S('Add alt text fields to the product editor', { c: 'Catalog', p: 2, fv: '2.3', l: 'a11y,feature' }),
      T('Upgrade Node to the current LTS in CI', { epic: 'E4', c: 'Platform', p: 3 }),
      S('Customer address book page', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.3' }),
      S('Show stock levels on the product page', { epic: 'E2', c: 'Catalog', p: 2, fv: '2.3' }),
      S('Remember the last used delivery address', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.3' }),
      S('Persist the cart across browser tabs', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.3' }),
      S('Lazy-load product images below the fold', { epic: 'E2', c: 'Catalog', p: 2, fv: '2.3', l: 'frontend' }),
    ],
  },
  {
    sprint: 22,
    rows: [
      S('Order history list with paging', { epic: 'E5', c: 'Accounts', p: 5, fv: '2.3' }),
      S('Reorder button on past orders', { epic: 'E5', c: 'Accounts', p: 3, fv: '2.3' }),
      S('Product image zoom on touch devices', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.3', l: 'mobile' }),
      S('Search suggestions as you type', { ref: 'typeahead', epic: 'E2', c: 'Search', p: 8, fv: '2.3', carry: true }),
      S('Recently viewed products strip', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.3' }),
      S('Guest checkout without creating an account', { ref: 'guest', epic: 'E1', c: 'Checkout,Accounts', p: 5, fv: '2.3' }),
      U('Update the order model for guests', 'guest'),
      U('Add the guest email step', 'guest'),
      S('Apple Pay button on the payment step', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.3' }),
      B('Coupon field loses focus after each keystroke', { epic: 'E1', c: 'Checkout', p: 1, fv: '2.3', reopen: true }),
      B('Postcode lookup returns nothing for UK outward codes', { epic: 'E1', c: 'Checkout', p: 2, fv: '2.3' }),
      S('Loyalty points balance in the account header', { epic: 'E3', c: 'Accounts', p: 3, fv: '2.3' }),
      S('Earn points on completed orders', { ref: 'earn', epic: 'E3', c: 'Accounts', p: 8, fv: '2.3', blocks: ['redeem'] }),
      T('Patch CVE-2026-21114 in the image processing library', { epic: 'E4', c: 'Platform', p: 2, l: 'security', d: CVE('CVE-2026-21114', 'the image processing library') }),
      T('Bump the postgres client to 16.4', { epic: 'E4', c: 'Platform', p: 1, by: 'bot', l: 'dependencies' }),
      S('Product comparison table', { c: 'Catalog', p: 5, fv: '2.3', l: 'feature' }),
      S('Add a size filter to the category page', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.3' }),
      S('Email preferences page', { epic: 'E3', c: 'Accounts', p: 3, fv: '2.3' }),
      B('Basket empties when the session expires mid-checkout', { c: 'Checkout', p: 3, fv: '2.3', late: true, epic: 'E1' }),
    ],
  },
  {
    sprint: 23,
    rows: [
      S('Redeem points at checkout', { ref: 'redeem', epic: 'E3', c: 'Checkout,Accounts', p: 8, fv: '2.3' }),
      S('Search results page redesign', { ref: 'results', epic: 'E2', c: 'Search', p: 8, fv: '2.4', slipped: '2.3', carry: true }),
      S('Add synonyms to the product search index', { epic: 'E2', c: 'Search', p: 3, fv: '2.3' }),
      S('Wishlist sharing by link', { c: 'Accounts', p: 3, fv: '2.3', l: 'feature' }),
      S('Save for later in the cart', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.3' }),
      S('Order status page', { epic: 'E5', c: 'Accounts', p: 5, fv: '2.3' }),
      S('Email notifications for shipped orders', { ref: 'ship-emails', epic: 'E5', c: 'Accounts', p: 5, fv: '2.4', slipped: '2.3', carry: true }),
      B('Order confirmation email shows the wrong currency', { epic: 'E5', c: 'Checkout', p: 2, fv: '2.3' }),
      B('Product page returns a 500 when a variant has no image', { c: 'Catalog', p: 3, fv: '2.3', epic: 'E2' }),
      T('Replace the deprecated payment SDK calls', { epic: 'E4', c: 'Platform,Checkout', p: 5, fv: '2.3' }),
      T('Bump jest and ts-jest', { epic: 'E4', c: 'Platform', p: 1, by: 'bot', l: 'dependencies' }),
      T('Patch CVE-2026-23780 in the session middleware', { epic: 'E4', c: 'Platform', p: 2, l: 'security', d: CVE('CVE-2026-23780', 'the session middleware') }),
      I('Checkout outage: payment provider timeouts', { ref: 'outage', c: 'Checkout', late: true, l: 'incident', p: null, d: INCIDENT('Card payments timed out for forty minutes while the provider degraded. Orders were retried by hand.') }),
      S('Gift message on orders', { c: 'Checkout', p: 2, fv: '2.3', late: true, l: 'feature' }),
      S('Product reviews summary on the product page', { epic: 'E2', c: 'Catalog', p: 5, fv: '2.3' }),
      S('Carousel of related products', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.3' }),
      S('Order summary on small screens', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.3', l: 'mobile' }),
      S('Loyalty banner in the cart', { epic: 'E3', c: 'Checkout,Accounts', p: 2, fv: '2.3' }),
      S('Filter product reviews by rating', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.3' }),
    ],
  },
  {
    sprint: 24,
    rows: [
      T('Upgrade the search cluster to enable typo tolerance', { ref: 'search-upgrade', c: 'Search', p: 5, fv: '2.4', blocks: ['tuning'] }),
      S('Product recommendations on the cart page', { epic: 'E2', c: 'Catalog,Checkout', p: 8, fv: '2.4', carry: true }),
      S('Saved payment methods page', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.4' }),
      S('Delete my account and data', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.4', l: 'compliance' }),
      S('Order tracking link in the shipped email', { epic: 'E5', c: 'Accounts', p: 3, fv: '2.4' }),
      S('Start a return from the order page', { ref: 'returns', epic: 'E5', c: 'Accounts', p: 8, fv: '2.4', carry: true, blocks: ['refund-status'] }),
      U('Return reasons and the refund choice', 'returns'),
      U('Notify the warehouse of a return', 'returns'),
      S('Express checkout for returning customers', { epic: 'E1', c: 'Checkout', p: 8, fv: '2.4', carry: true }),
      S('Address autocomplete on the checkout form', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.4' }),
      B('Discount applied twice when a coupon and a sale overlap', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.4', av: '2.3' }),
      B('Saved card expiry shows the wrong month', { epic: 'E3', c: 'Checkout,Accounts', p: 1, fv: '2.4', av: '2.3' }),
      B('Search facets count zero after filtering twice', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.4', av: '2.3', reopen: true }),
      B('Wishlist page times out with more than 200 items', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.4' }),
      I('Search index lagging behind the catalog by hours', { ref: 'lag', c: 'Search', late: true, l: 'incident', p: null, d: INCIDENT('New products took up to six hours to appear in search after the indexer fell behind.') }),
      T('Bump next to the latest minor', { epic: 'E4', c: 'Platform', p: 1, by: 'bot', l: 'dependencies' }),
      T('Upgrade the CI runners to the new image', { epic: 'E4', c: 'Platform', p: 3 }),
      T('Move session storage from Redis 6 to 7', { epic: 'E4', c: 'Platform', p: 5 }),
      S('Back-in-stock alerts', { c: 'Catalog', p: 3, fv: '2.4', late: true, l: 'feature' }),
      B('Double submit on the payment button creates two orders', { c: 'Checkout', p: 1, fv: '2.4', late: true, epic: 'E1' }),
      S('Wishlist items on the account dashboard', { epic: 'E3', c: 'Accounts', p: 3, fv: '2.4' }),
      S('Bulk add to cart from a wishlist', { epic: 'E3', c: 'Accounts', p: 3, fv: '2.4' }),
      S('Promo code suggestions at checkout', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.4' }),
      S('Zero-result search page with suggestions', { epic: 'E2', c: 'Search', p: 5, fv: '2.4' }),
      S('Estimated delivery on the product page', { epic: 'E1', c: 'Catalog,Checkout', p: 3, fv: '2.4' }),
      S('Sort search results by rating', { epic: 'E2', c: 'Search', p: 2, fv: '2.4' }),
    ],
  },
  {
    sprint: 25,
    rows: [
      S('Delivery date picker at checkout', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.4' }),
      S('Order notes for gift wrapping', { epic: 'E1', c: 'Checkout', p: 2, fv: '2.4', added: true }),
      S('Wishlist price-drop alerts', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.4' }),
      S('Loyalty tiers and tier badges', { ref: 'tiers', epic: 'E3', c: 'Accounts', p: 8, fv: '2.4', carry: true, start: -17, w: 'rp' }),
      U('Tier thresholds and the rule engine', 'tiers'),
      S('Search within a category', { epic: 'E2', c: 'Search,Catalog', p: 3, fv: '2.4' }),
      S('Refund status on the order page', { ref: 'refund-status', epic: 'E5', c: 'Accounts', p: 5, fv: '2.4' }),
      S('Print a return label', { epic: 'E5', c: 'Accounts', p: 3, fv: '2.4' }),
      B('Return request fails for orders paid with a gift card', { epic: 'E5', c: 'Accounts', p: 3, fv: '2.4' }),
      B('Mobile menu overlaps the search box on small phones', { c: 'Catalog', p: 2, fv: '2.4', l: 'mobile' }),
      B('Checkout hangs when the address service is slow', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.4', av: '2.3', ref: 'hang' }),
      T('Patch CVE-2026-31337 in the image resizer', { epic: 'E4', c: 'Platform', p: 2, l: 'security', fv: '2.4', d: CVE('CVE-2026-31337', 'the image resizer') }),
      T('Upgrade the payment gateway client to v4', { epic: 'E1', ref: 'gateway', c: 'Checkout,Platform', p: 5, fv: '2.4', blocks: ['bnpl'] }),
      T('Bump eslint and the typescript-eslint plugins', { c: 'Platform', p: 1, by: 'bot', l: 'dependencies' }),
      T('Cut the CI build time with a shared cache', { ref: 'cache', epic: 'E4', c: 'Platform', p: 5, carry: true, start: -16, w: 'do' }),
      T('Alert on slow checkout requests', { epic: 'E4', c: 'Platform,Checkout', p: 2, late: true }),
      I('Elevated 5xx on the product API after the deploy', { c: 'Catalog,Platform', late: true, l: 'incident', p: null, d: INCIDENT('A deploy raised the 5xx rate on the product API to four percent until it was rolled back.') }),
      S('Newsletter signup in the footer', { c: 'Accounts', p: 2, fv: '2.5', l: 'feature' }),
      S('Pickup point selection at checkout', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.4', added: true }),
      S('Save a basket for later across devices', { epic: 'E1', c: 'Checkout', p: 5, fv: '2.5' }),
      B('Rounding error in the loyalty discount on partial refunds', { epic: 'E3', c: 'Accounts', p: 2, fv: '2.4', added: true }),
      T('Add unit tests for the discount rules', { epic: 'E1', c: 'Checkout', p: 3, w: 'ag' }),
    ],
  },
  {
    sprint: 26,
    rows: [
      S('Buy now, pay later at checkout', { ref: 'bnpl', epic: 'E1', c: 'Checkout', p: 8, fv: '2.4', st: 'done', w: 'ac' }),
      S('Product bundles on the category page', { epic: 'E2', c: 'Catalog', p: 5, fv: '2.4', st: 'done', w: 'kn' }),
      S('Loyalty points history page', { epic: 'E3', c: 'Accounts', p: 3, fv: '2.4', st: 'done', w: 'js' }),
      B('Gift card balance shows in the wrong currency', { epic: 'E1', c: 'Checkout', p: 2, fv: '2.4', st: 'done', w: 'ml' }),
      T('Bump playwright to the latest release', { c: 'Platform', p: 1, by: 'bot', l: 'dependencies', st: 'done', w: 'tn' }),
      S('Refunds issued to the original payment method', { ref: 'refunds', epic: 'E5', c: 'Accounts', p: 5, fv: '2.4', st: 'review', w: 'rp', blocks: ['cancel'] }),
      S('Order cancellation before dispatch', { ref: 'cancel', epic: 'E5', c: 'Accounts,Checkout', p: 5, fv: '2.4', st: 'prog', w: 'kn' }),
      S('Size guide on product pages', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.4', st: 'prog', w: 'ac' }),
      T('Upgrade the Postgres cluster to 16', { ref: 'pg', epic: 'E4', c: 'Platform', p: 8, fv: '2.4', st: 'prog', w: 'sg', blocks: ['quebec'] }),
      T('Move image storage behind the CDN', { epic: 'E4', c: 'Platform,Catalog', p: 5, fv: '2.5', st: 'prog', w: 'sg' }),
      T('Replace the nightly export script', { epic: 'E4', c: 'Platform', p: 3, st: 'prog', w: 'sg' }),
      T('Rotate the TLS certificates before they expire', { epic: 'E4', c: 'Platform', p: 2, st: 'review', w: 'sg', due: -3 }),
      B('Checkout fails for postcodes with a trailing space', { epic: 'E1', c: 'Checkout', p: 2, fv: '2.4', st: 'review', w: 'js' }),
      B('Facet counts are stale after a bulk price update', { epic: 'E2', c: 'Catalog', p: 3, fv: '2.4', st: 'prog', w: 'ml' }),
      T('Patch CVE-2026-35002 in the HTTP client', { epic: 'E4', c: 'Platform', p: 2, fv: '2.4', st: 'review', w: 'do', l: 'security', d: CVE('CVE-2026-35002', 'the HTTP client') }),
      S('Birthday rewards for loyalty members', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.5', st: 'todo', w: 'none' }),
      S('Search relevance tuning dashboard', { ref: 'tuning', epic: 'E2', c: 'Search', p: 5, fv: '2.4', st: 'todo', w: 'none', due: -2 }),
      S('Customer reviews moderation queue', { epic: 'E2', c: 'Catalog', p: null, fv: '2.5', st: 'todo', w: 'none' }),
      I('Stale prices shown after the flash sale', { c: 'Catalog', late: true, l: 'incident', st: 'done', w: 'do', p: null, d: INCIDENT('Prices cached before the flash sale ended were served for an hour after it did.') }),
      B('Wrong tax on orders shipped to Quebec', { ref: 'quebec', c: 'Checkout', p: 3, fv: '2.4', st: 'todo', w: 'ac', late: true }),
      S('Saved baskets with a shareable link', { epic: 'E1', c: 'Checkout', p: null, fv: '2.4', st: 'todo', w: 'js', added: true }),
      S('Offer a pickup option in the order summary', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.4', st: 'todo', w: 'ml', added: true, late: true }),
    ],
  },
  {
    sprint: -1,
    rows: [
      S('Gift receipts for orders with a gift message', { epic: 'E1', c: 'Checkout', p: 3, fv: '2.5', st: 'todo' }),
      S('Wishlist for guests', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.5', st: 'todo' }),
      S('Dark mode for the storefront', { c: 'Catalog', p: 8, fv: '2.5', st: 'todo', l: 'feature' }),
      S('Faster product images on slow connections', { epic: 'E2', c: 'Catalog', p: 5, fv: '2.5', st: 'todo' }),
      S('Subscription orders for repeat purchases', { epic: 'E5', c: 'Checkout,Accounts', p: 13, fv: '2.5', st: 'todo' }),
      S('Admin export of customer orders', { c: 'Accounts', p: 3, st: 'todo', l: 'feature' }),
      T('Migrate the build to the new monorepo tooling', { epic: 'E4', c: 'Platform', p: 8, st: 'todo' }),
      T('Retire the legacy order API', { epic: 'E4', c: 'Platform', p: 8, fv: '2.5', st: 'todo' }),
      S('Review the fraud rules for the new payment methods', { c: 'Checkout', p: 3, st: 'todo', l: 'ktlo' }),
      S('Localise the checkout into French', { epic: 'E1', p: 8, fv: '2.5', st: 'todo' }),
      S('Gift card purchase flow', { epic: 'E1', c: 'Checkout', p: 8, fv: '2.5', st: 'todo' }),
      S('Share a wishlist with the household', { epic: 'E3', c: 'Accounts', p: 5, fv: '2.5', st: 'todo' }),
      S('Compare products side by side on mobile', { epic: 'E2', c: 'Catalog', p: 5, fv: '2.5', st: 'todo' }),
    ],
  },
];
