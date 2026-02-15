export interface MemberMetadata {
  totalCount: number;
  byType?: Partial<Record<'property' | 'method', number>>;
}
