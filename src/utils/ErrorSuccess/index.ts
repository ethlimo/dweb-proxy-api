export type Error<Tag, Type> = {
  error: true;
  _tag: Tag;
  _type: Type;
  reason: string;
};

export type Success<Result> = {
  error: false;
  result: Result;
};

export type ErrorSuccess<Result, Tag, Type, ErrorContext = {}> =
  | (Error<Tag, Type> & ErrorContext)
  | Success<Result>;
