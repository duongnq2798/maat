/** A condition the owner must look at: the publisher pushes nothing and exits. Its message never quotes a row. */
export class PublishStop extends Error {
  name = "PublishStop";
}

/** A failure that may pass, such as the network: this round pushes nothing and the next one tries again. */
export class PublishRetry extends Error {
  name = "PublishRetry";
}
