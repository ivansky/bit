import { Location, SchemaNode } from '../schema-node';

/**
 * e.g. 'string', 'boolean', etc.
 */
export class KeywordTypeSchema extends SchemaNode {
  constructor(readonly location: Location, private name: string) {
    super();
  }

  toString() {
    return this.name;
  }
}
