// The declared normalization table for the RxSolutions competency matrix —
// docs/competencies/COMPETENCY_MODEL.md §3–§5.3.
//
// EVERY ROW HERE IS A NORMALIZATION DECISION, made by a person and reviewable
// as one. That is why it is data in code rather than something inferred at
// import time: "Postgress" is PostgreSQL and "Oracle" under Database is not
// "Oracle" under ERP, and no algorithm can tell a typo from a second product.
//
// What this file is NOT: a seed. A declared competency is created only when
// the workbook actually contains it, and its provenance says where. A profile
// row the file never mentions creates nothing.
//
// Nothing in this file was derived from a person row. The level codes and
// their meanings were supplied with the milestone brief; the Agile training
// vocabulary is declared, not read (the workbook has no legend for it), and
// the import reports that as a decision to confirm.

export type AliasDecision =
  | 'EXACT'
  | 'CASE_OR_SPACING'
  | 'SPELLING_CORRECTION'
  | 'ABBREVIATION'
  | 'CATEGORY_QUALIFIED'
  | 'PROVISIONAL'
  | 'UNDECLARED';

export type CategoryKind =
  | 'PRODUCT_KNOWLEDGE'
  | 'FUNCTIONAL_DOMAIN'
  | 'TECHNICAL'
  | 'PROCESS'
  | 'AGILE_PRACTICE'
  | 'POWER_SKILL';

/** A source spelling and why it maps where it does. */
export interface DeclaredLabel {
  readonly label: string;
  readonly decision: AliasDecision;
}

export interface DeclaredLevel {
  readonly code: string;
  readonly label: string;
  readonly ordinal: number;
  /** Labels the source is known to use; the import adds any others it finds. */
  readonly sourceLabels: readonly string[];
}

export interface DeclaredScale {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly levels: readonly DeclaredLevel[];
  /** True when no header in the source defines this scale. Reported every run. */
  readonly declaredNotRead: boolean;
}

export interface DeclaredCategory {
  readonly code: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly ordinal: number;
  /** Band labels that mean this category. The first is the primary spelling. */
  readonly labels: readonly DeclaredLabel[];
}

export interface DeclaredCompetency {
  readonly categoryCode: string;
  /** Full code, `CATEGORY.COMPETENCY`. */
  readonly code: string;
  readonly name: string;
  readonly scaleCode: string;
  readonly labels: readonly DeclaredLabel[];
  /**
   * Other bands the same header has been seen under. Matching there resolves
   * to THIS competency, reported as a decision to confirm every run.
   */
  readonly alsoSeenUnder?: readonly string[];
  /** Set when the mapping needs an SME to confirm it (decision PROVISIONAL). */
  readonly provisional?: string;
}

export interface TrainingMatrixProfile {
  /** Band label whose columns are the competencies. */
  readonly presentBand: string;
  /** Band label whose columns are PER-PERSON targets, never imported. */
  readonly targetBand: string;
  readonly categoryCode: string;
}

export interface CompetencyImportProfile {
  readonly code: string;
  readonly importerVersion: string;
  readonly framework: {
    readonly code: string;
    readonly name: string;
    readonly description: string;
  };
  readonly defaultScaleCode: string;
  readonly scales: readonly DeclaredScale[];
  readonly categories: readonly DeclaredCategory[];
  readonly competencies: readonly DeclaredCompetency[];
  /** Headers that mark a row region as PEOPLE. */
  readonly identityHeaders: readonly string[];
  /** Header labels of person-attribute columns: excluded, and reported only by label. */
  readonly personAttributeHeaders: readonly string[];
  readonly trainingMatrix: TrainingMatrixProfile;
}

const exact = (label: string): DeclaredLabel => ({ label, decision: 'EXACT' });
const cased = (label: string): DeclaredLabel => ({ label, decision: 'CASE_OR_SPACING' });
const spelling = (label: string): DeclaredLabel => ({ label, decision: 'SPELLING_CORRECTION' });
const abbreviation = (label: string): DeclaredLabel => ({ label, decision: 'ABBREVIATION' });
const qualified = (label: string): DeclaredLabel => ({ label, decision: 'CATEGORY_QUALIFIED' });

const MATRIX = 'NI_R_A_G';
const AGILE = 'AGILE_TRAINING';

/** `LMS.RX_NET` from `LMS` and `RX_NET`, with the scale defaulted to the matrix's. */
const competency = (
  categoryCode: string,
  segment: string,
  name: string,
  labels: readonly DeclaredLabel[],
  extra: Partial<Pick<DeclaredCompetency, 'alsoSeenUnder' | 'provisional' | 'scaleCode'>> = {},
): DeclaredCompetency => ({
  categoryCode,
  code: `${categoryCode}.${segment}`,
  name,
  scaleCode: extra.scaleCode ?? MATRIX,
  labels,
  ...(extra.alsoSeenUnder === undefined ? {} : { alsoSeenUnder: extra.alsoSeenUnder }),
  ...(extra.provisional === undefined ? {} : { provisional: extra.provisional }),
});

export const RX_COMPETENCY_MATRIX_2024: CompetencyImportProfile = {
  code: 'RX_COMPETENCY_MATRIX_2024',
  importerVersion: 'competency-import-1',
  framework: {
    code: 'RXSOLUTIONS_COMPETENCY_MATRIX',
    name: 'RxSolutions Competency Matrix',
    description:
      'Reference competency framework imported structure-only from the RxSolutions competency ' +
      'matrix. Definitions only: no person, rating or target was imported.',
  },
  defaultScaleCode: MATRIX,
  scales: [
    {
      code: MATRIX,
      name: 'Competency matrix scale (NI / R / A / G)',
      description:
        'The reference equivalence supplied with COMPETENCY-M0/M1. No Expert level exists in the ' +
        'source and none is inferred.',
      declaredNotRead: false,
      levels: [
        { code: 'NI', label: 'Not Involved', ordinal: 0, sourceLabels: ['Not Involved'] },
        {
          code: 'R',
          label: 'Limited Involvement or Limited Competency',
          ordinal: 1,
          sourceLabels: ['Limited involvement', 'Limited competency'],
        },
        {
          code: 'A',
          label: 'Involved and Competency Improving',
          ordinal: 2,
          sourceLabels: ['Competency Improving'],
        },
        { code: 'G', label: 'Involved and Competent', ordinal: 3, sourceLabels: ['Competent'] },
      ],
    },
    {
      code: AGILE,
      name: 'Agile training status',
      description:
        'The Agile sheet records training status, not the matrix scale. Its equivalence to ' +
        'NI / R / A / G is not declared (decision CM-4).',
      declaredNotRead: true,
      levels: [
        { code: 'UNTRAINED', label: 'Untrained', ordinal: 0, sourceLabels: [] },
        { code: 'TRAINED', label: 'Trained', ordinal: 1, sourceLabels: [] },
        { code: 'CERTIFIED', label: 'Certified', ordinal: 2, sourceLabels: [] },
      ],
    },
  ],
  categories: [
    {
      code: 'LMS',
      name: 'LMS and product knowledge',
      kind: 'PRODUCT_KNOWLEDGE',
      ordinal: 1,
      labels: [exact('LMS')],
    },
    {
      code: 'FUNCTIONAL_DOMAIN',
      name: 'Functional and domain knowledge',
      kind: 'FUNCTIONAL_DOMAIN',
      ordinal: 2,
      labels: [exact('Functional/Domain'), abbreviation('Functional')],
    },
    { code: 'DESIGN', name: 'Design', kind: 'TECHNICAL', ordinal: 3, labels: [exact('Design')] },
    {
      code: 'DEVELOPMENT',
      name: 'Development',
      kind: 'TECHNICAL',
      ordinal: 4,
      labels: [exact('Development'), abbreviation('Coding')],
    },
    {
      code: 'DATABASE',
      name: 'Database',
      kind: 'TECHNICAL',
      ordinal: 5,
      labels: [exact('Database'), abbreviation('DB')],
    },
    { code: 'ERP', name: 'ERP', kind: 'TECHNICAL', ordinal: 6, labels: [exact('ERP')] },
    {
      code: 'BI_REPORTING',
      name: 'BI and reporting',
      kind: 'TECHNICAL',
      ordinal: 7,
      labels: [exact('BI & Reporting')],
    },
    {
      code: 'MIDDLEWARE',
      name: 'Middleware',
      kind: 'TECHNICAL',
      ordinal: 8,
      labels: [exact('Middleware')],
    },
    { code: 'DEVOPS', name: 'DevOps', kind: 'TECHNICAL', ordinal: 9, labels: [exact('DevOps')] },
    { code: 'COTS', name: 'COTS', kind: 'TECHNICAL', ordinal: 10, labels: [exact('COTS')] },
    {
      code: 'TESTING',
      name: 'Testing',
      kind: 'TECHNICAL',
      ordinal: 11,
      labels: [exact('Testing')],
    },
    {
      code: 'CLOUD',
      name: 'Cloud',
      kind: 'TECHNICAL',
      ordinal: 12,
      labels: [exact('Cloud'), abbreviation('Cloud Platform')],
    },
    {
      code: 'INFRASTRUCTURE',
      name: 'Infrastructure',
      kind: 'TECHNICAL',
      ordinal: 13,
      labels: [exact('Infrastructure'), abbreviation('Infra')],
    },
    { code: 'PROCESS', name: 'Process', kind: 'PROCESS', ordinal: 14, labels: [exact('Process')] },
    // Not a band label on the team sheets: the Agile sheet's Present block.
    {
      code: 'AGILE_PRACTICE',
      name: 'Agile practice',
      kind: 'AGILE_PRACTICE',
      ordinal: 15,
      labels: [],
    },
    {
      code: 'POWER_SKILLS',
      name: 'Power skills',
      kind: 'POWER_SKILL',
      ordinal: 16,
      labels: [exact('Power Skills')],
    },
  ],
  competencies: [
    competency('LMS', 'RX_NET', 'Rx.NET', [exact('Rx.NET')]),
    competency('LMS', 'NG', 'NG', [exact('NG')]),
    competency('LMS', 'OPTIFACTS', 'Optifacts', [exact('Optifacts')]),
    competency('LMS', 'INLAB', 'Inlab', [exact('Inlab')]),
    competency('LMS', 'OPTUITIVE', 'Optuitive', [exact('Optuitive')]),
    competency(
      'LMS',
      'RX_UNIVERSE',
      'Rx-Universe / Rx-Suite',
      [cased('RxUniverse'), cased('RxUniverse/RXSuite'), cased('Rx-Universe/ Rx-Suite')],
      {
        provisional:
          'Two sheets add "Rx-Suite" to this header. Whether Rx-Suite is the same product as ' +
          'Rx-Universe is unconfirmed (CM-7).',
      },
    ),
    competency('LMS', 'RXLAB_NET', 'Rxlab.NET', [exact('Rxlab.NET'), cased('RxLab.NET')]),
    competency('LMS', 'VISIONSTAR', 'VisionStar', [exact('VisionStar')]),

    competency('FUNCTIONAL_DOMAIN', 'RXSOLUN_OFS', 'RXSolun OFS', [exact('RXSolun OFS')], {
      alsoSeenUnder: ['LMS'],
      provisional:
        'Placed under Functional/Domain on four sheets and under LMS on two. Placed by majority, ' +
        'pending SME confirmation (CM-8).',
    }),
    competency('FUNCTIONAL_DOMAIN', 'B2B', 'B2B', [exact('B2B')]),
    competency('FUNCTIONAL_DOMAIN', 'ORDER_MANAGEMENT', 'Order Management', [
      exact('Order Management'),
      abbreviation('OM'),
    ]),
    competency('FUNCTIONAL_DOMAIN', 'FULFILMENT_SHIPPING', 'Fulfilment and Shipping', [
      cased('Fulfilment & Shipping'),
      abbreviation('F&S'),
    ]),
    competency('FUNCTIONAL_DOMAIN', 'PRINTING', 'Printing', [exact('Printing')]),
    competency('FUNCTIONAL_DOMAIN', 'PRICING_PROMOTIONS', 'Pricing and Promotions', [
      cased('Pricing & Promotions'),
      abbreviation('Pricing'),
    ]),
    competency('FUNCTIONAL_DOMAIN', 'CALCULATION', 'Calculation', [exact('Calculation')]),
    competency('FUNCTIONAL_DOMAIN', 'INTEGRATIONS', 'Integrations', [exact('Integrations')]),
    competency('FUNCTIONAL_DOMAIN', 'MASTER_DATA', 'Master Data', [exact('Master Data')]),

    competency('DESIGN', 'TECHNICAL_ARCHITECTURE', 'Technical Architecture', [
      abbreviation('Tech Arch'),
      spelling('Technical Architechture'),
    ]),

    competency('DEVELOPMENT', 'DOTNET', '.NET', [exact('.NET')]),
    competency('DEVELOPMENT', 'JAVA', 'Java', [exact('Java')]),
    competency('DEVELOPMENT', 'ANGULAR', 'Angular', [exact('Angular'), spelling('Agular')]),
    competency('DEVELOPMENT', 'REACT_JS', 'React JS', [exact('React JS'), cased('React Js')]),
    competency('DEVELOPMENT', 'RUBY', 'Ruby', [exact('Ruby')]),
    competency('DEVELOPMENT', 'ANSI_C', 'ANSI C', [cased('Ansi-C')]),
    competency('DEVELOPMENT', 'POWERBUILDER', 'PowerBuilder', [
      exact('PowerBuilder'),
      cased('Powerbuilder'),
    ]),
    competency('DEVELOPMENT', 'COBOL', 'COBOL', [cased('Cobol')]),
    competency('DEVELOPMENT', 'CPP', 'C++', [exact('C++')]),
    competency('DEVELOPMENT', 'FLUTTER', 'Flutter', [exact('Flutter')]),
    competency('DEVELOPMENT', 'ECRION', 'Ecrion', [exact('Ecrion')]),

    competency('DATABASE', 'SQL_SERVER', 'SQL Server', [exact('SQL Server')]),
    competency('DATABASE', 'MYSQL', 'MySQL', [exact('MySQL')]),
    competency('DATABASE', 'POSTGRESQL', 'PostgreSQL', [spelling('Postgress')]),
    competency('DATABASE', 'GREENPLUM', 'Greenplum', [exact('Greenplum')]),
    competency('DATABASE', 'ALLEGROGRAPH', 'AllegroGraph', [
      exact('AllegroGraph'),
      cased('Allegrograph'),
    ]),
    competency('DATABASE', 'INFORMIX', 'Informix', [exact('Informix')]),
    competency('DATABASE', 'ORACLE_DATABASE', 'Oracle Database', [qualified('Oracle')]),

    competency('ERP', 'MICROSOFT_DYNAMICS', 'Microsoft Dynamics', [
      exact('Microsoft Dynamics'),
      abbreviation('MS Dynamics'),
    ]),
    competency('ERP', 'SAP', 'SAP', [exact('SAP')]),
    competency('ERP', 'ORACLE_ERP', 'Oracle ERP', [qualified('Oracle')]),

    competency('BI_REPORTING', 'JASPER', 'Jasper', [exact('Jasper')]),
    competency('BI_REPORTING', 'SSRS', 'SSRS', [exact('SSRS')]),
    competency('BI_REPORTING', 'TALEND', 'Talend', [exact('Talend')]),
    competency('BI_REPORTING', 'QLIKVIEW', 'QlikView', [cased('Qlikview'), abbreviation('QV')]),
    competency('BI_REPORTING', 'QLIK_SENSE', 'Qlik Sense', [
      spelling('Qliksens'),
      abbreviation('QS'),
    ]),

    competency('MIDDLEWARE', 'MQ', 'MQ', [exact('MQ')]),
    competency('MIDDLEWARE', 'IIB', 'IIB', [exact('IIB')]),
    competency('MIDDLEWARE', 'APIGEE', 'Apigee', [cased('APIGEE')]),
    competency('MIDDLEWARE', 'DELL_BOOMI', 'Dell Boomi', [cased('DELL Boomi')]),

    // The band has no sub-header: the category is its own competency.
    competency('DEVOPS', 'DEVOPS', 'DevOps', [exact('DevOps')]),

    competency('COTS', 'IBM_ODM', 'IBM ODM (Rules)', [exact('IBM ODM (Rules)')]),
    competency('COTS', 'FORGEROCK', 'ForgeRock', [cased('Forgerock')]),
    competency('COTS', 'APPDYNAMICS', 'AppDynamics', [cased('Appdynamics')]),
    competency('COTS', 'SPLUNK', 'Splunk', [exact('Splunk')]),
    competency('COTS', 'LAUNCHDARKLY', 'LaunchDarkly', [cased('Launch Darkly')]),

    competency('TESTING', 'MANUAL', 'Manual testing', [qualified('Manual')]),
    competency('TESTING', 'AUTOMATED', 'Automated testing', [
      qualified('Automated'),
      cased('Automated testing'),
    ]),
    competency('TESTING', 'PERFORMANCE', 'Performance testing', [qualified('Performance')]),
    competency('TESTING', 'SECURITY', 'Security testing', [qualified('Security')]),

    competency('CLOUD', 'AWS', 'AWS', [exact('AWS')]),
    competency('CLOUD', 'AZURE', 'Azure', [exact('Azure')]),

    competency('INFRASTRUCTURE', 'IT_INFRASTRUCTURE', 'IT infrastructure', [
      abbreviation('IT Infra'),
      cased('IT Infrastructure'),
    ]),

    competency('PROCESS', 'AGILE', 'Agile', [cased('AGILE')]),

    competency('POWER_SKILLS', 'PRESENTATION', 'Presentation', [exact('Presentation')]),
    competency('POWER_SKILLS', 'COMMUNICATION', 'Communication', [exact('Communication')]),
    competency('POWER_SKILLS', 'LEADERSHIP', 'Leadership', [exact('Leadership')]),

    competency('AGILE_PRACTICE', 'AGILE_BASICS', 'Agile basics', [cased('Agile Basics')], {
      scaleCode: AGILE,
    }),
    competency(
      'AGILE_PRACTICE',
      'PRODUCT_OWNER_BASIC',
      'Product Owner (basic)',
      [abbreviation('PO (Basic)')],
      {
        scaleCode: AGILE,
      },
    ),
    competency(
      'AGILE_PRACTICE',
      'PRODUCT_OWNER_ADVANCED',
      'Product Owner (advanced)',
      [abbreviation('PO (Advanced)')],
      { scaleCode: AGILE },
    ),
    competency('AGILE_PRACTICE', 'SCRUM_DEVELOPER', 'Scrum developer', [exact('Scrum developer')], {
      scaleCode: AGILE,
    }),
    competency('AGILE_PRACTICE', 'SCRUM_MASTER', 'Scrum Master', [exact('Scrum Master')], {
      scaleCode: AGILE,
    }),
    competency('AGILE_PRACTICE', 'AGILE_COACH', 'Agile coach', [qualified('Coach')], {
      scaleCode: AGILE,
    }),
  ],
  identityHeaders: ['Full Name', 'Name', 'Employee number', 'Sr #'],
  personAttributeHeaders: [
    'Full Name',
    'Name',
    'Employee number',
    'Sr #',
    'Role',
    'Critical',
    'Int/Ext',
    'Project',
    'Vendor',
    'Experience',
    'Location',
    'Product/Service',
    'Team details',
    'Training plan to implement',
  ],
  trainingMatrix: { presentBand: 'Present', targetBand: 'Target', categoryCode: 'AGILE_PRACTICE' },
};
