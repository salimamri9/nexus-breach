variable "region" {
  description = "AWS region (eu-west-3 = Paris, close to Tunisia)"
  type        = string
  default     = "eu-west-3"
}

variable "instance_type" {
  description = "t3.small handles 60 players with headroom; t2.micro/t3.micro work but have only 1 GB RAM"
  type        = string
  default     = "t3.small"
}

variable "ssh_public_key" {
  description = "Public key allowed to SSH in as ubuntu"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
  sensitive   = true
}

variable "ssh_cidr" {
  description = "Who may SSH in (scripts/aws-up.sh sets this to your current IP /32)"
  type        = string
  default     = "0.0.0.0/0"
}
