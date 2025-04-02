type PossibleTypes = boolean | string;

type InputObject = { [key: string]: PossibleTypes[] };

export function cartesianProduct(
  input: InputObject,
): Array<{ [x: string]: PossibleTypes }> {
  const keys = Object.keys(input);
  const result = keys.reduce(
    (product, key) => {
      const newProduct: any[] = [];
      for (const obj of product) {
        for (const value of input[key]) {
          newProduct.push({ ...obj, [key]: value });
        }
      }
      return newProduct;
    },
    [{}],
  );
  return result;
}

function excludeProperties<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  let result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
}

export class TestRunner<T, O extends object> {
  _testCases: (T & { options: O })[];
  runners: { name: string; run: (thisvar: Mocha.Suite) => () => void }[] = [];

  constructor(testCases: (T & { options: O })[]) {
    this._testCases = testCases;
  }

  registerTests<X extends keyof O, K extends keyof T>(
    description: string,
    inputToLog: K[],
    optionsToExclude: X[],
    filterFunction: (testCase: T & { options: Omit<O, X> }) => boolean,
    func: (testCase: T & { options: Omit<O, X> }) => Promise<void>,
  ): void {
    const cases = this._testCases
      .map((testCase: T & { options: O }) => {
        const options = JSON.parse(
          JSON.stringify(testCase.options),
        ) as typeof testCase.options;
        const newOptions = excludeProperties(options, optionsToExclude);
        const ret: T & { options: Omit<O, X> } = {
          ...testCase,
          options: newOptions,
        };
        return ret;
      })
      .filter(
        (testCase, index, self) =>
          index ===
          self.findIndex((t) => JSON.stringify(t) === JSON.stringify(testCase)),
      )
      .flatMap((x) => x)
      .filter(filterFunction);

    const runner = cases.map((testCase) => {
      const nameBuilder: string[] = [];
      Object.keys(testCase).forEach((key) => {
        if (inputToLog.includes(key as K)) {
          nameBuilder.push(
            `${key}: ${JSON.stringify((testCase as unknown as any)[key])}`,
          );
        }
      });
      Object.keys(testCase.options).forEach((key) => {
        nameBuilder.push(
          `${key}: ${JSON.stringify((testCase.options as unknown as any)[key])}`,
        );
      });
      const name = description + " (" + nameBuilder.join(", ") + ")";
      return {
        name,
        run: (thisvar: Mocha.Suite) => func.bind(thisvar, testCase),
      };
    });
    this.runners.push(...runner);
  }

  runTests(thisvar: Mocha.Suite): void {
    let runner = this.runners.shift();
    while (runner) {
      it(runner.name, runner.run(thisvar));
      runner = this.runners.shift();
    }
  }
}
