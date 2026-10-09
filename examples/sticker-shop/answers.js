/**
 * Fixed answers for a fictional custom sticker shop (the same invented shop
 * as in agent-eval-harness). Prices, policies, hours and the address below
 * are made up.
 */

export const answers = [
  {
    id: 'shipping-time',
    reply: 'Orders ship within 2 business days after you approve the proof. '
      + 'Standard delivery then takes 3 to 5 business days.',
    phrases: [
      'how long does shipping take',
      'when will my order ship',
      'how long until i get my stickers',
      'how fast do you ship',
      'shipping time',
      'delivery time',
    ],
    // These turn a timing question into a problem with a specific order.
    avoid: ['damaged', 'lost', 'late', 'missing', 'refund', 'wrong', 'never', 'change', 'address'],
  },
  {
    id: 'shipping-cost',
    reply: 'Shipping is free on orders over $35. Below that, standard shipping is a flat $4.95.',
    phrases: ['how much is shipping', 'what does shipping cost', 'is shipping free', 'do you have free shipping'],
    description: 'the cost of shipping an order',
    avoid: ['refund', 'charged', 'twice'],
  },
  {
    id: 'international',
    reply: 'For now we ship to the United States and Canada only.',
    phrases: [
      'do you ship internationally',
      'do you ship to canada',
      'do you ship outside the us',
      'international shipping',
    ],
    description: 'which countries we ship to',
  },
  {
    id: 'sizes',
    reply: 'We print any shape from 1 inch up to 12 inches on the longest side.',
    phrases: [
      'what sizes do you print',
      'what sizes are available',
      'how big can stickers be',
      'whats the smallest size',
      'whats the largest size',
    ],
    description: 'the sticker sizes we print',
  },
  {
    id: 'waterproof',
    reply: 'All stickers are printed on waterproof vinyl with a UV laminate, rated for about 3 years outdoors.',
    phrases: [
      'are the stickers waterproof',
      'are they weatherproof',
      'can i put them outside',
      'are they dishwasher safe',
      'will they fade in the sun',
    ],
    description: 'whether stickers survive water, sun and outdoor use',
  },
  {
    id: 'file-formats',
    reply: 'Upload PNG, JPG, PDF, SVG, AI or EPS. Raster images need at least 300 DPI at the printed size.',
    phrases: [
      'what file formats do you accept',
      'what files can i upload',
      'can i upload a png',
      'do you accept svg',
      'what resolution do i need',
    ],
    description: 'artwork file formats and resolution',
    // A question about the customer's own file needs a preflight check, not this FAQ.
    avoid: ['wrong', 'replace', 'change', 'logo', 'check', 'edge'],
  },
  {
    id: 'minimum-order',
    reply: 'The minimum is 10 stickers per design, and you can mix designs in one order.',
    phrases: ['what is the minimum order', 'is there a minimum', 'can i order just one sticker', 'minimum quantity'],
    description: 'the minimum order quantity',
    avoid: ['cancel'],
  },
  {
    id: 'proof',
    reply: 'Before printing we email you a digital proof. Printing starts only after you approve it, '
      + 'and changes to the proof are free.',
    phrases: [
      'what is a proof',
      'do i get a proof',
      'will i see a proof before printing',
      'can i see it before you print',
    ],
    description: 'the digital proof we send before printing',
    avoid: ['change', 'fix', 'typo', 'reject'],
  },
  {
    id: 'contact',
    reply: 'Email help@example.com, Monday to Friday, 9am to 5pm Eastern. We reply within one business day.',
    phrases: ['how can i contact you', 'what are your hours', 'how do i reach support', 'is there a phone number'],
    description: 'how to contact support and support hours',
    // "the email of the person who ordered 10501" is a privacy question, not this FAQ.
    avoid: ['ordered'],
  },
];

/** One canonical word per group; every variant is scored as that word. */
export const synonyms = {
  ship: ['shipping', 'shipped', 'ships', 'delivery', 'deliver', 'delivered', 'arrive', 'arrives'],
  sticker: ['stickers', 'decal', 'decals', 'label', 'labels'],
  waterproof: ['weatherproof', 'water', 'rain'],
  cost: ['price', 'prices', 'costs', 'fee', 'fees'],
  file: ['files', 'artwork', 'image', 'images', 'format', 'formats'],
  big: ['large', 'largest', 'biggest', 'huge'],
  small: ['smallest', 'tiny', 'little'],
  size: ['sizes', 'dimensions'],
  contact: ['reach', 'call', 'phone'],
  minimum: ['min', 'least'],
  outside: ['outdoors', 'outdoor'],
};

export const stopwords = [
  'a', 'an', 'the', 'is', 'are', 'am', 'do', 'does', 'did', 'i', 'me', 'my', 'you', 'your', 'we', 'our',
  'it', 'they', 'them', 'to', 'of', 'for', 'on', 'in', 'at', 'and', 'or', 'can', 'could', 'will', 'would',
  'be', 'there', 'what', 'whats', 'how', 'please', 'hi', 'hello', 'hey', 'thanks', 'just', 'so', 'any',
  'with', 'get', 'have', 'has', 'if', 'this', 'that', 'u', 'ur', 'pls',
];

export const fallback = 'Sorry, I could not answer that right now. A person from our team will reply by email.';
