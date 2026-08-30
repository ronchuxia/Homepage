import {
  App,
  CfnOutput,
  Duration,
  Stack,
  aws_apigateway as apigateway,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_ecr as ecr,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';

const TRACE_BUCKET = 'xiachu-homepage-chat-logs';
const TRACE_PREFIX = 'chat_logs';

const app = new App();
const stack = new Stack(app, 'Homepage', {
  env: { region: 'us-east-1' },
});

const repository = new ecr.Repository(stack, 'BackendRepository', {
  repositoryName: 'homepage-backend',
  imageScanOnPush: true,
  lifecycleRules: [{ maxImageCount: 10 }],
});

const providerKeys = new secretsmanager.Secret(stack, 'ProviderKeys', {
  description: 'Anthropic and OpenAI API keys for the chat backend',
});

const originSecret = new secretsmanager.Secret(stack, 'OriginSecret', {
  description: 'Shared x-origin-verify value between CloudFront and the backend',
  generateSecretString: { excludePunctuation: true, passwordLength: 32 },
});

const backend = new lambda.DockerImageFunction(stack, 'Backend', {
  code: lambda.DockerImageCode.fromEcr(repository, {
    tagOrDigest: stack.node.tryGetContext('imageTag') ?? 'latest',
  }),
  architecture: lambda.Architecture.ARM_64,
  memorySize: 512,
  timeout: Duration.seconds(180),
  reservedConcurrentExecutions: 5,
  logGroup: new logs.LogGroup(stack, 'BackendLogs', {
    retention: logs.RetentionDays.ONE_MONTH,
  }),
  environment: {
    CHAT_LOG_MODE: 'full',
    CHAT_LOG_DESTINATION: 's3',
    CHAT_LOG_S3_BUCKET: TRACE_BUCKET,
    CHAT_LOG_S3_PREFIX: TRACE_PREFIX,
    CHAT_ORIGIN_SECRET: originSecret.secretValue.unsafeUnwrap(),
    PROVIDER_KEYS_SECRET_ARN: providerKeys.secretArn,
  },
});
providerKeys.grantRead(backend);
backend.addToRolePolicy(new iam.PolicyStatement({
  actions: ['s3:PutObject'],
  resources: [`arn:aws:s3:::${TRACE_BUCKET}/${TRACE_PREFIX}/*`],
}));

const alias = new lambda.Alias(stack, 'BackendAlias', {
  aliasName: 'production',
  version: backend.currentVersion,
});

const integration = new apigateway.LambdaIntegration(alias, {
  responseTransferMode: apigateway.ResponseTransferMode.STREAM,
});

const api = new apigateway.RestApi(stack, 'BackendApi', {
  restApiName: 'homepage-backend',
  endpointTypes: [apigateway.EndpointType.REGIONAL],
  deployOptions: {
    throttlingRateLimit: 5,
    throttlingBurstLimit: 10,
    accessLogDestination: new apigateway.LogGroupLogDestination(
      new logs.LogGroup(stack, 'ApiAccessLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
    ),
    accessLogFormat: apigateway.AccessLogFormat.clf(),
  },
});
const apiRoot = api.root.addResource('api');
apiRoot.addResource('chat').addMethod('POST', integration);
apiRoot.addResource('health').addMethod('GET', integration);
apiRoot.addResource('materials').addResource('{proxy+}').addMethod('GET', integration);

const certificate = new acm.Certificate(stack, 'SiteCertificate', {
  domainName: 'xiachu.dev',
  subjectAlternativeNames: ['www.xiachu.dev'],
  validation: acm.CertificateValidation.fromDns(),
});

const siteRouter = new cloudfront.Function(stack, 'SiteRouter', {
  runtime: cloudfront.FunctionRuntime.JS_2_0,
  code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.headers.host.value === 'www.xiachu.dev') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://xiachu.dev' + request.uri } },
    };
  }
  if (
    !request.uri.startsWith('/assets/') &&
    !request.uri.startsWith('/content/') &&
    request.uri !== '/vite.svg'
  ) {
    request.uri = '/index.html';
  }
  return request;
}
`),
});

const frontendBucket = s3.Bucket.fromBucketName(stack, 'FrontendBucket', 'xiachu-homepage');

const distribution = new cloudfront.Distribution(stack, 'Site', {
  domainNames: ['xiachu.dev', 'www.xiachu.dev'],
  certificate,
  defaultRootObject: 'index.html',
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    functionAssociations: [{
      function: siteRouter,
      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
    }],
  },
  additionalBehaviors: {
    '/api/*': {
      origin: new origins.RestApiOrigin(api, {
        customHeaders: { 'x-origin-verify': originSecret.secretValue.unsafeUnwrap() },
      }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    },
  },
});

new CfnOutput(stack, 'DistributionDomain', { value: distribution.distributionDomainName });
