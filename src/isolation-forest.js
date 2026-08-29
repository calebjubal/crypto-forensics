'use strict';

function seededRandom(seed = 73129) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
function expectedPath(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
}
function build(rows, depth, maxDepth, random) {
  if (rows.length <= 1 || depth >= maxDepth) return { n: rows.length };
  const candidates = [];
  for (let feature = 0; feature < rows[0].length; feature++) {
    let min = Infinity, max = -Infinity;
    for (const row of rows) { min = Math.min(min, row[feature]); max = Math.max(max, row[feature]); }
    if (max > min) candidates.push({ feature, min, max });
  }
  if (!candidates.length) return { n: rows.length };
  const { feature, min, max } = candidates[Math.floor(random() * candidates.length)];
  const split = min + (max - min) * Math.max(Number.EPSILON, random());
  const left = [], right = [];
  for (const row of rows) (row[feature] < split ? left : right).push(row);
  return { feature, split, left: build(left, depth + 1, maxDepth, random), right: build(right, depth + 1, maxDepth, random) };
}
function pathLength(row, node, depth = 0) {
  if ('n' in node) return depth + expectedPath(node.n);
  return pathLength(row, row[node.feature] < node.split ? node.left : node.right, depth + 1);
}
function train(rows, { trees = 64, sampleSize = 256, seed = 73129 } = {}) {
  if (rows.length < 32) return null;
  const random = seededRandom(seed), n = Math.min(sampleSize, rows.length), forest = [];
  for (let i = 0; i < trees; i++) {
    const indices = Array.from({ length: rows.length }, (_, j) => j);
    for (let j = 0; j < n; j++) { const k = j + Math.floor(random() * (indices.length - j)); [indices[j], indices[k]] = [indices[k], indices[j]]; }
    forest.push(build(indices.slice(0, n).map(j => rows[j]), 0, Math.ceil(Math.log2(n)), random));
  }
  return { forest, sampleSize: n, seed, trees };
}
function score(model, row) {
  if (!model) return null;
  const average = model.forest.reduce((sum, tree) => sum + pathLength(row, tree), 0) / model.trees;
  return Math.pow(2, -average / expectedPath(model.sampleSize));
}
module.exports = { train, score, seededRandom };
