import { ComponentAspect } from './component.aspect';

export { useComponentHost } from './host';
export { Component, InvalidComponent } from './component';
export { ComponentID } from '@teambit/component-id';
export { default as ComponentFS } from './component-fs';
export type { default as ComponentConfig } from './config';
export type { ComponentFactory } from './component-factory';
export type { AspectList } from './aspect-list';
export { AspectEntry, AspectData, ResolveComponentIdFunc } from './aspect-entry';
// TODO: check why it's not working when using the index in snap dir like this:
// export { Snap, Author } from './snap';
export { Snap, SnapProps } from './snap/snap';
export type { Author } from './snap/author';
// TODO: check why it's not working when using the index in tag dir like this:
// export { Tag } from './tag';
export { Tag, TagProps } from './tag/tag';
export { State } from './state';
export type { Hash } from './hash';
export { TagMap } from './tag-map';
export { ComponentMap } from './component-map';
export type { ComponentMain } from './component.main.runtime';
export type { ComponentUI } from './component.ui.runtime';
export { Section } from './section';
export { ComponentContext, ComponentDescriptorContext, useComponentDescriptor } from './ui/context/component-context';
export type { ComponentProviderProps, ComponentDescriptorProviderProps } from './ui/context';
export { componentFields, componentIdFields, componentOverviewFields } from './ui';
export { ConsumePlugin } from './ui/menu';
export { RegisteredComponentRoute, ComponentUrlParams } from './component.route';
export { ComponentModel, ComponentModelProps } from './ui/component-model';
export type { ShowFragment, ShowRow } from './show';
export { default as Config } from './config';
// export { AspectList } from './aspect-list';
// export { AspectEntry } from './aspect-entry';
export { ComponentAspect };
export default ComponentAspect;
