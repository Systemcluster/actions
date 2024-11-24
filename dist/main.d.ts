import { type ReleaseResult } from 'release-branch';
export interface ActionReleaseResult extends ReleaseResult {
    action: string;
}
export interface ActionReleaseResults {
    results: ActionReleaseResult[];
    summary: string;
}
export declare const main: (push?: boolean) => Promise<ActionReleaseResults>;
