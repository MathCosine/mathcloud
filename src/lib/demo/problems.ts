/**
 * The demo contest's papers. Every answer was checked by computation.
 * `wrong` lists the mistakes a real field tends to make, so the grading
 * screens have realistic clusters to rule on.
 */
import type { AnswerType } from '../model';

export type DemoProblem = { text: string; answers: string[]; type?: AnswerType; wrong?: string[]; alt?: string[] };

export const INDIVIDUAL: DemoProblem[] = [
  { text: 'Compute $2 + 0 \\times 2 + 6$.', answers: ['8'], wrong: ['16', '0'] },
  { text: 'A sea turtle swims $3$ km per hour. How many kilometres does it swim in $2$ hours and $40$ minutes?', answers: ['8'], wrong: ['7', '9'] },
  { text: 'How many positive divisors does $36$ have?', answers: ['9'], wrong: ['8', '7'] },
  { text: 'The average of five numbers is $12$. One number is removed and the average of the remaining four is $10$. What number was removed?', answers: ['20'], wrong: ['2', '10'] },
  { text: 'What is the sum of the interior angles of a hexagon, in degrees?', answers: ['720'], wrong: ['1080', '540'] },
  { text: 'How many two-digit positive integers have digits that sum to $9$?', answers: ['9'], wrong: ['8', '10'] },
  { text: 'A fair coin is flipped $3$ times. What is the probability of getting exactly two heads?', answers: ['\\frac{3}{8}'], type: 'expression', wrong: ['1/2', '1/4'], alt: ['3/8', '0.375'] },
  { text: 'Find the remainder when $7^{2027}$ is divided by $10$.', answers: ['3'], wrong: ['7', '9', '1'] },
  { text: 'A right triangle has hypotenuse $13$ and one leg $5$. What is its area?', answers: ['30'], wrong: ['32.5', '60'] },
  { text: 'In how many ways can the letters of OCEAN be arranged?', answers: ['120'], wrong: ['24', '60'] },
  { text: 'If $x + \\frac{1}{x} = 5$, what is $x^2 + \\frac{1}{x^2}$?', answers: ['23'], wrong: ['25', '27'] },
  { text: 'What is the smallest positive integer $n$ for which $n!$ ends in exactly three zeros?', answers: ['15'], wrong: ['20', '10'] },
  { text: 'A square and an equilateral triangle have the same perimeter. The square has area $81$. What is the side length of the triangle?', answers: ['12'], wrong: ['27', '9'] },
  { text: 'How many positive integers less than $100$ are divisible by $3$ or by $5$, but not by both?', answers: ['40'], wrong: ['46', '47'] },
  { text: 'Find the sum of all positive integers $n$ for which $n^2 - 19n + 99$ is a perfect square.', answers: ['38'], wrong: ['19', '28'] },
  { text: 'Two fair six-sided dice are rolled. What is the probability that the product of the two numbers is even?', answers: ['\\frac{3}{4}'], type: 'expression', wrong: ['1/2', '2/3'], alt: ['3/4', '0.75', '27/36'] },
  { text: 'How many ordered pairs of positive integers $(a, b)$ satisfy $\\frac{1}{a} + \\frac{1}{b} = \\frac{1}{6}$?', answers: ['9'], wrong: ['5', '8'] },
  { text: 'A regular hexagon has side length $2$. What is the square of its area?', answers: ['108'], wrong: ['48', '36'] },
  { text: 'Find the last two digits of $3^{2027}$.', answers: ['87'], wrong: ['27', '43', '67'] },
  { text: 'How many subsets of $\\{1, 2, \\ldots, 10\\}$ (including the empty set) contain no two consecutive integers?', answers: ['144'], wrong: ['89', '143', '55'] },
];

export const MYSTERY: DemoProblem[] = [
  { text: 'Each member of your team secretly picks a positive integer. The four numbers multiply to $36$. What is the smallest their sum can be?', answers: ['10'], wrong: ['11', '12'] },
  { text: 'How many squares of any size are on an $8 \\times 8$ chessboard?', answers: ['204'], wrong: ['64', '196'] },
  { text: 'What is the smaller angle, in degrees, between the hands of a clock at $3{:}20$?', answers: ['20'], wrong: ['30', '0'] },
  { text: 'The sequence $2, 6, 12, 20, 30, \\ldots$ continues in the same pattern. What is its $20$th term?', answers: ['420'], wrong: ['380', '400'] },
  { text: 'In how many ways can $10$ identical pearls be shared among $3$ different oysters so that each oyster gets at least one?', answers: ['36'], wrong: ['66', '45'] },
  { text: 'What is the largest prime factor of $6081$?', answers: ['2027'], wrong: ['6081', '3'] },
];

/** Six sets of four; point values rise by set. */
export const GUTS: DemoProblem[][] = [
  [
    { text: 'Compute $1 + 2 + \\cdots + 20$.', answers: ['210'], wrong: ['200', '190'] },
    { text: 'How many minutes are in a week?', answers: ['10080'], wrong: ['1440', '10800'] },
    { text: 'Compute $\\sqrt{144} + \\sqrt{169}$.', answers: ['25'], wrong: ['24', '17'] },
    { text: 'How many edges does a cube have?', answers: ['12'], wrong: ['8', '6'] },
  ],
  [
    { text: 'What is the greatest common divisor of $84$ and $120$?', answers: ['12'], wrong: ['6', '4'] },
    { text: 'What is the least common multiple of $4$, $6$ and $15$?', answers: ['60'], wrong: ['360', '30'] },
    { text: 'How many primes are less than $30$?', answers: ['10'], wrong: ['9', '11'] },
    { text: 'Compute $\\binom{8}{3}$.', answers: ['56'], wrong: ['336', '24'] },
  ],
  [
    { text: 'What is the sum of the digits of $2^{10}$?', answers: ['7'], wrong: ['10', '8'] },
    { text: 'What is the area of the triangle with vertices $(0,0)$, $(6,0)$ and $(0,8)$?', answers: ['24'], wrong: ['48', '14'] },
    { text: 'How many diagonals does a decagon have?', answers: ['35'], wrong: ['45', '70'] },
    { text: 'What is the smallest integer greater than $1$ that leaves remainder $1$ when divided by each of $2, 3, 4, 5, 6$?', answers: ['61'], wrong: ['121', '31'] },
  ],
  [
    { text: 'How many zeros does $100!$ end in?', answers: ['24'], wrong: ['20', '25'] },
    { text: 'Compute $\\log_2 64 + \\log_3 81$.', answers: ['10'], wrong: ['9', '12'] },
    { text: 'Compute $1^2 + 2^2 + \\cdots + 10^2$.', answers: ['385'], wrong: ['55', '400'] },
    { text: 'How many positive divisors does $2026$ have?', answers: ['4'], wrong: ['2', '6'] },
  ],
  [
    { text: 'Solve $3^{x} = 9^{x-2}$ for $x$.', answers: ['4'], wrong: ['2', '-4'] },
    { text: 'A positive divisor of $60$ is chosen at random. What is the probability that it is even?', answers: ['\\frac{2}{3}'], type: 'expression', wrong: ['1/2', '3/4'], alt: ['2/3', '8/12'] },
    { text: 'How many points $(x, y)$ with integer coordinates lie on the circle $x^2 + y^2 = 25$?', answers: ['12'], wrong: ['4', '8'] },
    { text: 'What is the sum of the first $10$ odd positive integers?', answers: ['100'], wrong: ['110', '90'] },
  ],
  [
    { text: 'Find the remainder when $2^{100}$ is divided by $7$.', answers: ['2'], wrong: ['1', '4'] },
    { text: 'How many three-digit numbers are palindromes?', answers: ['90'], wrong: ['100', '81'] },
    { text: 'In how many ways can a $2 \\times 8$ rectangle be tiled with $1 \\times 2$ dominoes?', answers: ['34'], wrong: ['21', '55'] },
    { text: 'Compute $\\lfloor \\sqrt{2027} \\rfloor$.', answers: ['45'], wrong: ['44', '46'] },
  ],
];

export const GUTS_POINTS = [4, 5, 6, 7, 8, 9];
