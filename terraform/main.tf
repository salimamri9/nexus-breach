terraform {
  required_providers {

    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.92"
    }


  }
  required_version = ">=1.2"
}

provider "aws" {
  region = var.region
}

# Ubuntu 24.04 LTS, latest official image for the region
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_key_pair" "nexus" {
  key_name   = "nexus-breach"
  public_key = file(pathexpand(var.ssh_public_key))
}

# web open to everyone; SSH only from the deploying machine
resource "aws_security_group" "nexus" {
  name        = "nexus-breach"
  description = "Nexus Breach game server"

  ingress {
    description = "HTTP to nginx and the game"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS once a domain points here"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "nexus_game_instance" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.nexus.key_name
  vpc_security_group_ids = [aws_security_group.nexus.id]
  user_data              = file("${path.module}/cloud-init.yaml")

  # t2/t3: never throttle during the event (bursts above baseline are billed per vCPU-hour instead)
  credit_specification {
    cpu_credits = "unlimited"
  }

  root_block_device {
    volume_size = 16
    volume_type = "gp3"
  }

  tags = {
    Name = "nexus-breach"
  }
}

# a fixed address: the QR code and links stay valid across reboots
resource "aws_eip" "nexus" {
  instance = aws_instance.nexus_game_instance.id
  domain   = "vpc"
  tags = {
    Name = "nexus-breach"
  }
}
