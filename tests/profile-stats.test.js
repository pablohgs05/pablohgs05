'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {chooseContributions}=require('../scripts/update-profile-stats.js');

test('keeps higher public count when private token sees fewer contributions',()=>{
  assert.deepEqual(chooseContributions([
    {commits:535,prs:59,issues:4},
    {commits:219,prs:17,issues:2}
  ]),{commits:535,prs:59,issues:4});
});

test('uses larger private counts per metric without summing overlapping records',()=>{
  assert.deepEqual(chooseContributions([
    {commits:120,prs:7,issues:4},
    {commits:150,prs:5,issues:8}
  ]),{commits:150,prs:7,issues:8});
});

test('treats zero activity as a valid year',()=>{
  assert.deepEqual(chooseContributions([
    {commits:0,prs:0,issues:0}
  ]),{commits:0,prs:0,issues:0});
});

test('refuses missing or malformed contribution data',()=>{
  assert.throws(()=>chooseContributions([]),/No contribution data/);
  assert.throws(()=>chooseContributions([{commits:-1,prs:0,issues:0}]),/Invalid commits/);
  assert.throws(()=>chooseContributions([{commits:1.5,prs:0,issues:0}]),/Invalid commits/);
  assert.throws(()=>chooseContributions([{commits:1,prs:null,issues:0}]),/Invalid prs/);
});
