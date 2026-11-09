import type { Locator } from '@playwright/test';

import { expect } from '../fixtures';

import BasePage from './base-page';

export class ConsolePluginPage extends BasePage {
  private readonly codeEditor = this.page.locator('.co-code-editor');
  private readonly pfCodeEditor = this.page.locator('.pf-v6-c-code-editor');

  async navigateToConsolePlugins(): Promise<void> {
    await this.goTo('/k8s/cluster/operator.openshift.io~v1~Console/cluster/console-plugins');
  }

  async navigateToPluginDetails(pluginName: string): Promise<void> {
    await this.goTo(`/k8s/cluster/console.openshift.io~v1~ConsolePlugin/${pluginName}`);
  }

  async navigateToPluginManifest(pluginName: string): Promise<void> {
    await this.goTo(
      `/k8s/cluster/console.openshift.io~v1~ConsolePlugin/${pluginName}/plugin-manifest`,
    );
  }

  getPluginNameCell(pluginName: string): Locator {
    return this.page.getByTestId(`data-view-cell-${pluginName}-name`);
  }

  getPluginStatusCell(pluginName: string): Locator {
    return this.page.getByTestId(`${pluginName}-status`);
  }

  getCodeEditor(): Locator {
    return this.codeEditor;
  }

  getReadOnlyCodeEditor(): Locator {
    return this.pfCodeEditor;
  }

  getEmptyBox(): Locator {
    return this.page.getByTestId('empty-box');
  }

  async clickEditPluginButton(pluginName: string): Promise<void> {
    const row = this.getPluginNameCell(pluginName).locator('xpath=ancestor::tr');
    const editButton = row.getByTestId('edit-console-plugin');
    await this.robustClick(editButton);
  }

  async navigateToOverview(): Promise<void> {
    await this.goTo('/');
  }

  async openAboutModal(): Promise<void> {
    const helpToggle = this.page.getByTestId('help-dropdown-toggle');
    const aboutItem = this.page.getByRole('menuitem', { name: 'About', exact: true });
    // The help dropdown can close before the menu item is clicked if a
    // re-render or focus change races the interaction.  Retry the toggle
    // click until the menu item is confirmed visible.
    await expect(async () => {
      if (!(await aboutItem.isVisible().catch(() => false))) {
        await helpToggle.click();
      }
      await expect(aboutItem).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await aboutItem.click();
  }

  async navigateToDynamicRoute(id: string): Promise<void> {
    await this.goTo(`/dynamic-route-${id}`);
  }

  async navigateToTestUtilities(): Promise<void> {
    await this.goTo('/test-utility-consumer');
  }

  async navigateToDemoListPage(): Promise<void> {
    await this.goTo('/demo-list-page');
  }

  async navigateToK8sApi(): Promise<void> {
    await this.goTo('/test-k8sapi');
  }

  async navigateToProjects(): Promise<void> {
    await this.goTo('/k8s/cluster/projects');
  }

  async navigateWithQueryParam(queryString: string): Promise<void> {
    await this.goTo(`/?${queryString}`);
  }
}
