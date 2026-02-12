import { describe, it, expect, beforeEach } from 'vitest';
import { TelestackClient, CollectionReference, DocumentReference } from '../src/index';

describe('Telestack SDK Core', () => {
    let client: TelestackClient;

    beforeEach(() => {
        client = new TelestackClient({
            endpoint: 'http://localhost:8787',
            workspaceId: 'test-ws',
            userId: 'test-user'
        });
    });

    describe('Hierarchical Path Resolution', () => {
        it('should correctly resolve top-level collection paths', () => {
            const users = client.collection('users');
            expect(users.path).toBe('users');
        });

        it('should correctly resolve document paths', () => {
            const userRef = client.collection('users').doc('user123');
            expect(userRef.path).toBe('users/user123');
        });

        it('should correctly resolve deeply nested sub-collection paths', () => {
            const posts = client.collection('users').doc('u1').collection('posts');
            expect(posts.path).toBe('users/u1/posts');
        });

        it('should correctly resolve deeply nested document paths', () => {
            const postRef = client.collection('users').doc('u1').collection('posts').doc('p1');
            expect(postRef.path).toBe('users/u1/posts/p1');
        });
    });

    describe('Fluent Query Matcher (Local Filtering)', () => {
        it('should match documents with == operator', () => {
            const query = client.collection('tasks').where('status', '==', 'done');
            expect((query as any).matches({ status: 'done' })).toBe(true);
            expect((query as any).matches({ status: 'todo' })).toBe(false);
        });

        it('should match documents with numeric operators', () => {
            const query = client.collection('items').where('price', '>', 50);
            expect((query as any).matches({ price: 100 })).toBe(true);
            expect((query as any).matches({ price: 20 })).toBe(false);
            expect((query as any).matches({ price: 50 })).toBe(false);
        });

        it('should match documents with multiple conditions (AND)', () => {
            const query = client.collection('users')
                .where('age', '>=', 18)
                .where('active', '==', true);

            expect((query as any).matches({ age: 20, active: true })).toBe(true);
            expect((query as any).matches({ age: 15, active: true })).toBe(false);
            expect((query as any).matches({ age: 20, active: false })).toBe(false);
        });

        it('should match documents with != operator', () => {
            const query = client.collection('tasks').where('status', '!=', 'deleted');
            expect((query as any).matches({ status: 'active' })).toBe(true);
            expect((query as any).matches({ status: 'deleted' })).toBe(false);
        });

        it('should match documents with in operator', () => {
            const query = client.collection('items').where('category', 'in', ['electronics', 'books']);
            expect((query as any).matches({ category: 'electronics' })).toBe(true);
            expect((query as any).matches({ category: 'books' })).toBe(true);
            expect((query as any).matches({ category: 'clothing' })).toBe(false);
        });
    });
});
