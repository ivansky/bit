import chai, { expect } from 'chai';
import path from 'path';
import { DEFAULT_LANE } from '@teambit/lane-id';
import { statusWorkspaceIsCleanMsg } from '../../../src/constants';
import Helper from '../../../src/e2e-helper/e2e-helper';
import * as fixtures from '../../../src/fixtures/fixtures';

chai.use(require('chai-fs'));

describe('merge lanes', function () {
  this.timeout(0);
  let helper: Helper;
  before(() => {
    helper = new Helper();
  });
  after(() => {
    helper.scopeHelper.destroy();
  });
  describe('export a local lane into a remote scope', () => {
    let authorScope;
    let importedScope;
    let appOutput: string;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      appOutput = helper.fixtures.populateComponents();
      helper.command.createLane('dev');
      helper.command.snapAllComponents();
      helper.command.exportLane();
      authorScope = helper.scopeHelper.cloneLocalScope();
    });
    describe('merging remote lane into main', () => {
      before(() => {
        helper.scopeHelper.reInitLocalScopeHarmony();
        helper.scopeHelper.addRemoteScope();
        helper.command.fetchRemoteLane('dev');
        helper.command.mergeRemoteLane(`dev`);
      });
      it('should save the files to the filesystem', () => {
        helper.fs.outputFile('app.js', fixtures.appPrintComp1(helper.scopes.remote));
        const result = helper.command.runCmd('node app.js');
        expect(result.trim()).to.equal(appOutput);
      });
      it('bit status should show the components as staged', () => {
        const status = helper.command.statusJson();
        expect(status.stagedComponents).to.have.lengthOf(3);
      });
      it('bit lane should show that all components are belong to main', () => {
        const lanes = helper.command.listLanesParsed();
        const defaultLane = lanes.lanes.find((lane) => lane.name === DEFAULT_LANE);
        expect(defaultLane.components).to.have.lengthOf(3);
      });
      describe('exporting the components to the remote', () => {
        let exportOutput: string;
        before(() => {
          exportOutput = helper.command.export();
        });
        it('should indicate that the components were exported successfully', () => {
          expect(exportOutput).to.not.have.string('nothing to export');
        });
        it('the remote should have the updated component objects', () => {
          const comp1Id = `${helper.scopes.remote}/comp1`;
          const comp1 = helper.command.catComponent(comp1Id);
          const remoteComp1 = helper.command.catComponent(comp1Id, helper.scopes.remotePath);
          expect(remoteComp1).to.have.property('head');
          expect(remoteComp1.head).to.equal(comp1.head);
        });
      });
    });
    describe('merging remote lane into main when components are not in workspace using --existing flag', () => {
      let mergeOutput;
      before(() => {
        helper.scopeHelper.reInitLocalScopeHarmony();
        helper.scopeHelper.addRemoteScope();
        helper.command.fetchRemoteLane('dev');
        mergeOutput = helper.command.mergeRemoteLane(`dev`, undefined, `--existing`);
      });
      it('should indicate that the components were not merge because they are not in the workspace', () => {
        expect(mergeOutput).to.have.string('the merge has been canceled on the following component(s)');
        expect(mergeOutput).to.have.string('is not in the workspace');
      });
      it('bitmap should not save any component', () => {
        const bitMap = helper.bitMap.readComponentsMapOnly();
        expect(Object.keys(bitMap)).to.have.lengthOf(0);
      });
      it('should not save the files to the filesystem', () => {
        expect(path.join(helper.scopes.localPath, 'components/bar/foo')).to.not.be.a.path();
      });
      it('bit status should show clean state', () => {
        const output = helper.command.runCmd('bit status');
        expect(output).to.have.string(statusWorkspaceIsCleanMsg);
      });
      it('bit lane should not show the components as if they belong to main', () => {
        const lanes = helper.command.listLanesParsed();
        const defaultLane = lanes.lanes.find((lane) => lane.name === DEFAULT_LANE);
        expect(defaultLane.components).to.have.lengthOf(0);
      });
    });
    describe('importing a remote lane which is ahead of the local lane', () => {
      before(() => {
        helper.scopeHelper.reInitLocalScopeHarmony();
        helper.scopeHelper.addRemoteScope();
        helper.command.switchRemoteLane('dev');
        importedScope = helper.scopeHelper.cloneLocalScope();
        helper.scopeHelper.getClonedLocalScope(authorScope);
        helper.fixtures.populateComponents(undefined, undefined, ' v2');
        helper.command.snapAllComponents();
        helper.command.exportLane();

        helper.scopeHelper.getClonedLocalScope(importedScope);
        helper.command.fetchRemoteLane('dev');
      });
      it('bit status should show all components as pending update', () => {
        const status = helper.command.statusJson();
        expect(status.outdatedComponents).to.have.lengthOf(3);
      });
      describe('merging the remote lane', () => {
        let mergeOutput;
        before(() => {
          mergeOutput = helper.command.mergeRemoteLane(`dev`);
        });
        it('should succeed', () => {
          expect(mergeOutput).to.have.string('successfully merged components');
        });
        it('should save the latest versions from the remote into the local', () => {
          helper.fs.outputFile('app.js', fixtures.appPrintComp1(helper.scopes.remote));
          const result = helper.command.runCmd('node app.js');
          expect(result.trim()).to.equal('comp1 and comp2 and comp3');
        });
        it('bit status should show clean state', () => {
          const output = helper.command.runCmd('bit status');
          expect(output).to.have.string(statusWorkspaceIsCleanMsg);
        });
        it('bit lane should show that all components are belong to the local lane', () => {
          const lane = helper.command.showOneLaneParsed('dev');
          expect(lane.components).to.have.lengthOf(3);
        });
        it('bit lane --merged should not show the lane as it was not merged into main yet', () => {
          const merged = helper.command.listLanes('--merged');
          expect(merged).to.not.have.string('dev');
          expect(merged).to.have.string('None of the lanes is merged');
        });
        it('bit lane --unmerged should show the lane', () => {
          const merged = helper.command.listLanes('--not-merged');
          expect(merged).to.have.string('dev');
          expect(merged).to.not.have.string('All lanes are merged');
        });
      });
    });
    describe('creating a new lane with the same name on a different workspace', () => {
      before(() => {
        helper.scopeHelper.reInitLocalScopeHarmony();
        helper.scopeHelper.addRemoteScope();
        helper.bitJsonc.setupDefault();
        helper.command.createLane('dev');
        helper.fixtures.createComponentBarFoo();
        helper.fixtures.addComponentBarFooAsDir();
        helper.command.snapAllComponentsWithoutBuild();
      });
      it('should not merge the two lanes on the remote, instead, it should throw', () => {
        expect(() => helper.command.export()).to.throw('unable to merge');
      });
    });
  });
  describe('merging main into local lane', () => {
    let mergeOutput: string;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.command.createLane('dev');
      helper.fixtures.populateComponents(1);
      helper.command.snapAllComponentsWithoutBuild();
      mergeOutput = helper.command.mergeLane('main');
    });
    it("should not throw an error that main lane doesn't exist", () => {
      expect(mergeOutput).to.not.have.string('unable to switch to "main", the lane was not found');
    });
  });
  describe('merging main into local lane when main has tagged versions', () => {
    let mergeOutput: string;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.fixtures.populateComponents(1);
      helper.command.tagAllWithoutBuild();
      helper.command.createLane('dev');
      helper.fixtures.populateComponents(1, undefined, 'v2');
      helper.command.snapAllComponentsWithoutBuild();
      mergeOutput = helper.command.mergeLane('main');
    });
    it("should not throw an error that main lane doesn't exist", () => {
      expect(mergeOutput).to.not.have.string('getDivergeData: unable to find Version 0.0.1 of comp1');
    });
  });
  describe('merging main lane with no snapped components', () => {
    let mergeOutput: string;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.fixtures.populateComponents(1);
      helper.command.createLane('dev');
      mergeOutput = helper.command.mergeLane('main');
    });
    it('should not throw an error about missing objects', () => {
      expect(mergeOutput).to.not.have.string(
        'component comp1 is on the lane but its objects were not found, please re-import the lane'
      );
    });
  });
  describe('merging a lane into main when main is empty', () => {
    let mergeOutput: string;
    before(() => {
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.fixtures.populateComponents(1);
      helper.command.createLane('dev');
      helper.command.snapAllComponentsWithoutBuild();
      helper.command.switchLocalLane('main');
      mergeOutput = helper.command.mergeLane('dev');
    });
    it('should not throw an error that head is empty', () => {
      expect(mergeOutput).to.have.string('successfully merged');
    });
    it('the component should be available on main', () => {
      const list = helper.command.listParsed();
      expect(list).to.have.lengthOf(1);
    });
  });
});
