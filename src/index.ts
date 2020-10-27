import path = require('path');
import run = require('promisify-tuple');
import {ContactContent, Msg} from 'ssb-typescript';
const ssbKeys = require('ssb-keys');
const SecretStack = require('secret-stack');
const makeConfig = require('ssb-config/inject');
import generateMsg from './generate';
import {Opts, MsgsByType, Follows, Blocks} from './types';
import {paretoSample} from './sample';
import slimify from './slimify';
import writeReportFile from './report';

function* range(start: number, end: number) {
  if (start > end) return;
  let i = start;
  while (i <= end) {
    yield i;
    i++;
  }
}

export = async function generateFixture(opts?: Partial<Opts>) {
  const outputDir = opts?.outputDir ?? path.join(process.cwd(), 'data');
  const numMessages = Math.max(opts?.messages ?? 1e4, 1);
  const numAuthors = Math.max(opts?.authors ?? 150, 1);
  const slim = opts?.slim ?? true;
  const report = opts?.report ?? true;

  const peer = SecretStack({appKey: require('ssb-caps').shs})
    .use(require('ssb-master'))
    .use(require('ssb-logging'))
    .use(require('ssb-db'))
    .call(
      null,
      makeConfig('ssb', {
        path: outputDir,
        logging: {
          level: 'info',
        },
        connections: {
          incoming: {},
          outgoing: {},
        },
      }),
    );

  const msgs: Array<Msg> = [];
  const msgsByType: MsgsByType = {};
  const authors = Array.from(range(1, numAuthors))
    .map((_, i) => (i === 0 ? peer.keys : ssbKeys.generate()))
    .map((keys) => peer.createFeed(keys));

  const follows: Follows = new Map(authors.map((a) => [a.id, new Set()]));
  const blocks: Blocks = new Map(authors.map((a) => [a.id, new Set()]));
  function updateFollowsAndBlocks(msg: Msg<ContactContent>) {
    const authorFollows = follows.get(msg.value.author)!;
    if (msg.value.content.following === true) {
      authorFollows.add(msg.value.content.contact!);
    } else if (msg.value.content.following === false) {
      authorFollows.delete(msg.value.content.contact!);
    }
    const authorBlocks = blocks.get(msg.value.author)!;
    if (msg.value.content.blocking === true) {
      authorBlocks.add(msg.value.content.contact!);
    } else if (msg.value.content.blocking === false) {
      authorBlocks.delete(msg.value.content.contact!);
    }
  }

  for (let i of range(0, numMessages - 1)) {
    let author = paretoSample(authors);
    // LATESTMSG is always authored by database owner
    if (i === numMessages - 1) author = peer.createFeed(peer.keys);
    var [err, posted]: [any, Msg?] = await run<any>(author.add)(
      generateMsg(i, numMessages, author, msgsByType, authors, follows, blocks),
    );

    if (err) {
      console.error(err);
      process.exit(1);
    } else if (posted?.value.content) {
      msgs.push(posted);
      msgsByType[posted.value.content.type!] ??= [];
      msgsByType[posted.value.content.type!]!.push(posted);
      if (posted.value.content.type === 'contact') {
        updateFollowsAndBlocks(posted as Msg<ContactContent>);
      }
      // console.log(`${JSON.stringify(posted, null, 2)}\n`);
    }
  }

  if (report) {
    writeReportFile(msgs, msgsByType, authors, follows, outputDir);
  }

  peer.close(() => {
    if (slim) {
      slimify(outputDir);
    }
  });
};