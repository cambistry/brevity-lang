Any actor/process can be cloned. Results in a recursive copy of the actor and its hosted subactors.

The deep clone is easiest, as otherwise we would need to consider what initialization means for every subprocess in the actor scope.

Cloning should create a new process running the same code/interface, and repopulating the dest scope to match the source. It should NOT simply run the constructor function.

This is done recursively for each subprocess in scope to create new copies.

Question: what about closures for child constructors?
