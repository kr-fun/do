import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import _ from 'lodash';
import shortid from 'shortid';
import { recreateTables } from '../helpers';
import db from 'server/db';
import Card from 'server/models/Card';

chai.use(chaiAsPromised);

const boardId = shortid.generate();
const listId = shortid.generate();
const commentId = shortid.generate();
const comment2Id = shortid.generate();
const cardId = shortid.generate();
const card2Id = shortid.generate();
const card3Id = shortid.generate();
const userId = shortid.generate();

describe('Card', () => {
  beforeEach(() => recreateTables().then(setup));

  describe('create', () => {
    const cardData = {
      text: 'test card',
    };

    it('should create card', () => {
      return Card.create(listId, cardData).then(card => {
        assert.property(card, 'id');
        assert.deepEqual(_.omit(card, ['id']), {
          text: cardData.text,
          link: '/boards/' + boardId + '/cards/' + card.id,
        });
      });
    });

    it('should generate shortid', () => {
      return Card.create(listId, cardData).then(card => {
        assert.isTrue(shortid.isValid(card.id));
      });
    });

    it('should relate card to list', () => {
      return Card.create(listId, cardData)
        .then(card => {
          return db.one(
            `SELECT list_id FROM lists_cards WHERE card_id = $1`,
            [card.id]
          );
        })
        .then(result => {
          assert.equal(result.list_id, listId);
        });
    });
  });

  describe('update', () => {
    it('should update card and return updated card with id and updated fields', () => {
      return Card.update(cardId, { text: 'updated text' })
      .then(card => {
        assert.deepEqual(card, {
          id: cardId,
          text: 'updated text',
        });
      });
    });
  });

  describe('drop', () => {
    it('should assign to deleted prop current timestamp', () => {
      return Card.drop(cardId)
        .then(() => {
          return db.one(
            `SELECT deleted FROM cards WHERE id = $1`,
            [cardId]
          );
        })
        .then(card => {
          assert.isNumber(card.deleted);
        });
    });

    it('should return dropped card id and board id which card belongs', () => {
      return Card.drop(cardId)
        .then(result => {
          assert.deepEqual(result, {
            id: cardId,
          });
        });
    });
  });

  describe('findById', () => {
    it('should return card with all relations', () => {
      return Card.findById(card2Id)
        .then(card => {
          assert.property(card.comments[0], 'created_at');

          delete card.comments[0].created_at;

          assert.deepEqual(card, {
            id: card2Id,
            text: 'test card 2',
            link: '/boards/' + boardId + '/cards/' + card2Id,
            board_id: boardId,
            comments: [{
              id: comment2Id,
              text: 'test comment 2',
              user: {
                id: userId,
                username: 'testuser',
              },
            }],
          });
        });
    });

    it('should not return deleted cards', () => {
      const promise = Card.findById(card3Id);
      return assert.isRejected(promise, /No data returned/);
    });
  });

  describe('getColors', () => {
    it('should return card colors array', () => {
      return Card.getColors(cardId).then((colors) => {
        assert.notEqual(colors.length, 0);
        assert.deepEqual(_.keys(colors[0]), ['id', 'color', 'active']);
      });
    });

    it('should return entry with `active` field if card has it color', () => {
      const cardId = shortid.generate();
      return db.none(
        `INSERT INTO cards(id, text, colors)
        VALUES ($1, 'test card', array[1, 3])`,
        [cardId]
      )
        .then(() => {
          return Card.getColors(cardId).then(colors => {
            const active = colors.filter(c => c.active === true);
            assert.lengthOf(active, 2);
          });
        });
    });
  });

  describe('addColor', () => {
    it('should add color id to card', () => {
      return Card.addColor(cardId, 2)
        .then(() => {
          return db.one(
            `SELECT colors FROM cards WHERE id = $1`,
            [cardId]
          );
        })
        .then(({ colors }) => {
          assert.deepEqual(colors, [2]);
        });
    });
  });

  describe('removeColor', () => {
    it('should remove color id from card', () => {
      const cardId = shortid.generate();
      return db.none(
        `INSERT INTO cards(id, text, colors)
        VALUES ($1, 'test card', array[1, 3])`,
        [cardId]
      )
        .then(() => {
          return Card.removeColor(cardId, 3);
        })
        .then(() => {
          return db.one(
            `SELECT colors FROM cards WHERE id = $1`,
            [cardId]
          );
        })
        .then(({ colors }) => {
          assert.deepEqual(colors, [1]);
        });
    });
  });

  describe('move', () => {
    beforeEach(() => recreateTables().then(() => db.none(
      `INSERT INTO lists(id, title) VALUES ('1', 'list 1'), ('2', 'list 2');
      INSERT INTO cards(id, text)
      VALUES ('1', 'card 1'), ('2', 'card 2'), ('3', 'card 3');
      INSERT INTO lists_cards
      VALUES ('1', '1'), ('1', '2'), ('2', '3')`
    )));

    const sourceList = {
      id: '1',
      cards: ['1'],
    };
    const targetList = {
      id: '2',
      cards: ['3', '2'],
    };

    it('should set new cards ids according to provided data', () => {
      return Card.move(sourceList, targetList)
        .then(() => db.query(`SELECT card_id FROM lists_cards WHERE list_id = '1' ORDER BY card_index`))
        .then(ids => assert.deepEqual(ids, [{
          card_id: '1',
        }]))
        .then(() => db.query(`SELECT card_id FROM lists_cards WHERE list_id = '2' ORDER BY card_index`))
        .then(ids => assert.deepEqual(ids, [{
          card_id: '3',
        }, {
          card_id: '2',
        }]))
    });

    it('should return lists with updated cards', () => {
      return Card.move(sourceList, targetList)
        .then(result => assert.deepEqual(result, [{
          id: '1',
          cards: ['1'],
        }, {
          id: '2',
          cards: ['3', '2'],
        }]));
    });
  });
});

function setup() {
  return db.none(
    `INSERT INTO users (id, username, email, hash, salt)
    VALUES ($1, 'testuser', 'testuser@test.com', 'hash', 'salt');
    INSERT INTO boards (id, title) VALUES ($6, 'test board');
    INSERT INTO lists (id, title) VALUES ($7, 'test list');
    INSERT INTO boards_lists VALUES ($6, $7);
    INSERT INTO cards (id, text, deleted)
    VALUES ($2, 'test card 1', null), ($3, 'test card 2', null), ($8, 'test card 3', 1);
    INSERT INTO lists_cards VALUES ($7, $2), ($7, $3), ($7, $8);
    INSERT INTO comments (id, text, deleted) VALUES ($4, 'test comment 1', '1'), ($5, 'test comment 2', null);
    INSERT INTO cards_comments VALUES ($3, $4), ($3, $5);
    INSERT INTO users_comments VALUES ($1, $4), ($1, $5)`,
    [userId, cardId, card2Id, commentId, comment2Id, boardId, listId, card3Id]
  );
}
