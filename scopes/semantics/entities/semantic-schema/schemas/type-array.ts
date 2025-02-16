import { Transform } from 'class-transformer';
import { Location, SchemaNode } from '../schema-node';
import { schemaObjToInstance } from '../schema-obj-to-class';

export class TypeArraySchema extends SchemaNode {
  @Transform(schemaObjToInstance)
  readonly type: SchemaNode;
  constructor(readonly location: Location, type: SchemaNode) {
    super();
    this.type = type;
  }

  toString() {
    return `${this.type.toString()}[]`;
  }
}
